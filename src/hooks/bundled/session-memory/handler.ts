/**
 * Session memory hook handler
 *
 * Spawns a memory consolidation subagent when /new command is triggered.
 * The subagent has expanded context (SOUL.md, MEMORY.md, USER.md) to produce
 * quality memory summaries equivalent to the main agent doing it manually.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import { hasInterSessionUserProvenance } from "../../../sessions/input-provenance.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";

const log = createSubsystemLogger("hooks/session-memory");

/**
 * Build the memory consolidation task prompt.
 */
function buildConsolidationPrompt(params: {
  sessionFile: string;
  sessionKey: string;
  date: string;
}): string {
  return `# Memory Consolidation Task

You are consolidating memories from a previous session. Your job is to:

1. Read the session log at: ${params.sessionFile}
2. Extract important information worth remembering
3. Update the appropriate memory files

## CRITICAL: How to read the session log
Session logs can be 500KB+. You MUST use chunked reading:

1. First check size: \`wc -c ${params.sessionFile}\`
2. If > 50KB, use: \`tail -300 ${params.sessionFile}\` to get recent messages
3. NEVER read the entire file at once — it will cause connection timeouts
4. Parse the JSONL format: each line is a message object with role/content
5. Focus on user messages and assistant responses, skip verbose tool outputs

## What to extract:
- Key decisions made
- Important events or milestones
- Lessons learned or insights
- User preferences or requests to remember
- Project updates or status changes
- Any "remember this" moments

## Where to write:
- \`memory/${params.date}.md\` — Daily log (what happened today)
- \`MEMORY.md\` — Long-term memories (significant patterns, lessons, relationships)
- \`USER.md\` — User-specific info (preferences, habits, context)
- \`SELF-REVIEW.md\` — Mistakes made and lessons (if any)

## Rules:
- Merge with existing content, don't overwrite
- Skip trivial conversations (greetings, small talk)
- Write in the same style as existing memory files
- Be concise but capture what matters
- If nothing significant happened, just report "No significant updates"

## Output:
When done, briefly report what you updated (or that nothing needed updating).
Do NOT send any messages to the user - this is a silent background task.`;
}

/**
 * Try the active transcript first; if /new already rotated it,
 * fallback to the latest .jsonl.reset.* sibling.
 */
async function getRecentSessionContentWithResetFallback(
  sessionFilePath: string,
  messageCount: number = 15,
): Promise<string | null> {
  const primary = await getRecentSessionContent(sessionFilePath, messageCount);
  if (primary) {
    return primary;
  }

  try {
    const dir = path.dirname(sessionFilePath);
    const base = path.basename(sessionFilePath);
    const resetPrefix = `${base}.reset.`;
    const files = await fs.readdir(dir);
    const resetCandidates = files.filter((name) => name.startsWith(resetPrefix)).toSorted();

    if (resetCandidates.length === 0) {
      return primary;
    }

    const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
    const fallback = await getRecentSessionContent(latestResetPath, messageCount);

    if (fallback) {
      log.debug("Loaded session content from reset fallback", {
        sessionFilePath,
        latestResetPath,
      });
    }

    return fallback || primary;
  } catch {
    return primary;
  }
}

function stripResetSuffix(fileName: string): string {
  const resetIndex = fileName.indexOf(".reset.");
  return resetIndex === -1 ? fileName : fileName.slice(0, resetIndex);
}

async function findPreviousSessionFile(params: {
  sessionsDir: string;
  currentSessionFile?: string;
  sessionId?: string;
}): Promise<string | undefined> {
  try {
    const files = await fs.readdir(params.sessionsDir);
    const fileSet = new Set(files);

    const baseFromReset = params.currentSessionFile
      ? stripResetSuffix(path.basename(params.currentSessionFile))
      : undefined;
    if (baseFromReset && fileSet.has(baseFromReset)) {
      return path.join(params.sessionsDir, baseFromReset);
    }

    const trimmedSessionId = params.sessionId?.trim();
    if (trimmedSessionId) {
      const canonicalFile = `${trimmedSessionId}.jsonl`;
      if (fileSet.has(canonicalFile)) {
        return path.join(params.sessionsDir, canonicalFile);
      }

      const topicVariants = files
        .filter(
          (name) =>
            name.startsWith(`${trimmedSessionId}-topic-`) &&
            name.endsWith(".jsonl") &&
            !name.includes(".reset."),
        )
        .toSorted()
        .toReversed();
      if (topicVariants.length > 0) {
        return path.join(params.sessionsDir, topicVariants[0]);
      }
    }

    if (!params.currentSessionFile) {
      return undefined;
    }

    const nonResetJsonl = files
      .filter((name) => name.endsWith(".jsonl") && !name.includes(".reset."))
      .toSorted()
      .toReversed();
    if (nonResetJsonl.length > 0) {
      return path.join(params.sessionsDir, nonResetJsonl[0]);
    }
  } catch {
    // Ignore directory read errors.
  }
  return undefined;
}

/**
 * Save session context to memory when /new command is triggered
 */
const spawnMemoryConsolidation: HookHandler = async (event) => {
  // Only trigger on 'new' command
  if (event.type !== "command" || event.action !== "new") {
    return;
  }

  try {
    log.debug("Hook triggered for /new command");

    const context = event.context || {};
    const cfg = context.cfg as OpenClawConfig | undefined;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir = cfg
      ? resolveAgentWorkspaceDir(cfg, agentId)
      : path.join(resolveStateDir(process.env, os.homedir), "workspace");
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // Get today's date for filename
    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Generate descriptive slug from session using LLM
    // Prefer previousSessionEntry (old session before /new) over current (which may be empty)
    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {}) as Record<
      string,
      unknown
    >;
    const currentSessionId = sessionEntry.sessionId as string;
    let currentSessionFile = (sessionEntry.sessionFile as string) || undefined;

    // If sessionFile is empty or looks like a new/reset file, try to find the previous session file.
    if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
      const sessionsDirs = new Set<string>();
      if (currentSessionFile) {
        sessionsDirs.add(path.dirname(currentSessionFile));
      }
      sessionsDirs.add(path.join(workspaceDir, "sessions"));

      for (const sessionsDir of sessionsDirs) {
        const recoveredSessionFile = await findPreviousSessionFile({
          sessionsDir,
          currentSessionFile,
          sessionId: currentSessionId,
        });
        if (!recoveredSessionFile) {
          continue;
        }
        currentSessionFile = recoveredSessionFile;
        log.debug("Found previous session file", { file: currentSessionFile });
        break;
      }
    }

    log.debug("Session context resolved", {
      sessionId: currentSessionId,
      sessionFile: currentSessionFile,
      hasCfg: Boolean(cfg),
    });

    const sessionFile = currentSessionFile || undefined;

    // Read message count from hook config (default: 15)
    const hookConfig = resolveHookConfig(cfg, "session-memory");
    const messageCount =
      typeof hookConfig?.messages === "number" && hookConfig.messages > 0
        ? hookConfig.messages
        : 15;

    let slug: string | null = null;
    let sessionContent: string | null = null;

    if (sessionFile) {
      // Get recent conversation content, with fallback to rotated reset transcript.
      sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
      log.debug("Session content loaded", {
        length: sessionContent?.length ?? 0,
        messageCount,
      });

      // Avoid calling the model provider in unit tests; keep hooks fast and deterministic.
      const isTestEnv =
        process.env.OPENCLAW_TEST_FAST === "1" ||
        process.env.VITEST === "true" ||
        process.env.VITEST === "1" ||
        process.env.NODE_ENV === "test";
      const allowLlmSlug = !isTestEnv && hookConfig?.llmSlug !== false;

      if (sessionContent && cfg && allowLlmSlug) {
        log.debug("Calling generateSlugViaLLM...");
        // Use LLM to generate a descriptive slug
        slug = await generateSlugViaLLM({ sessionContent, cfg });
        log.debug("Generated slug", { slug });
      }
    }

    // If no slug, use timestamp
    if (!slug) {
      const timeSlug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "");
      slug = timeSlug.slice(0, 4); // HHMM
      log.debug("Using fallback timestamp slug", { slug });
    }

    // Create filename with date and slug
    const filename = `${dateStr}-${slug}.md`;
    const memoryFilePath = path.join(memoryDir, filename);
    log.debug("Memory file path resolved", {
      filename,
      path: memoryFilePath.replace(os.homedir(), "~"),
    });

    // Format time as HH:MM:SS UTC
    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    // Extract context details
    const sessionId = (sessionEntry.sessionId as string) || "unknown";
    const sessionFile = (sessionEntry.sessionFile as string) || "";
    const previousSessionKey = event.sessionKey || "";

    // Skip if no valid session info
    if (sessionId === "unknown" || !sessionFile) {
      log.debug("No previous session to archive");
      return;
    }

    // Resolve agent ID from the previous session
    const agentId = normalizeAgentId(resolveAgentIdFromSessionKey(previousSessionKey));

    // Generate a unique session key with "memory-consolidation" in the name
    // This triggers the expanded bootstrap allowlist in workspace.ts
    const consolidationSessionKey = `agent:${agentId}:subagent:memory-consolidation:${crypto.randomUUID()}`;

    // Get today's date for the memory file
    const today = new Date().toISOString().split("T")[0];

    const task = buildConsolidationPrompt({
      sessionFile,
      sessionKey: previousSessionKey,
      date: today,
    });

    log.info("Spawning memory consolidation subagent", {
      sessionId,
      consolidationSessionKey,
    });

    // Spawn the consolidation subagent via gateway
    // deliver: false ensures no output is sent to the user
    await callGateway({
      method: "agent",
      params: {
        message: task,
        sessionKey: consolidationSessionKey,
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
      },
      timeoutMs: 600_000, // 10 minute timeout for consolidation
    });

    log.info("Memory consolidation subagent spawned successfully");
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to spawn memory consolidation", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to spawn memory consolidation", { error: String(err) });
    }
  }
};

export default spawnMemoryConsolidation;
