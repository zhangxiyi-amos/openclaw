/**
 * Session memory hook handler
 *
 * Spawns a memory consolidation subagent when /new command is triggered.
 * The subagent has expanded context (SOUL.md, MEMORY.md, USER.md) to produce
 * quality memory summaries equivalent to the main agent doing it manually.
 */

import crypto from "node:crypto";
import type { HookHandler } from "../../hooks.js";
import { resolveAgentIdFromSessionKey } from "../../../config/sessions.js";
import { callGateway } from "../../../gateway/call.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { normalizeAgentId } from "../../../routing/session-key.js";

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
 * Spawn a memory consolidation subagent when /new is triggered.
 * Uses a special session key naming convention to get expanded bootstrap files.
 */
const spawnMemoryConsolidation: HookHandler = async (event) => {
  // Only trigger on 'new' command
  if (event.type !== "command" || event.action !== "new") {
    return;
  }

  try {
    log.debug("Hook triggered for /new command");

    const context = event.context || {};
    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {}) as Record<
      string,
      unknown
    >;
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
