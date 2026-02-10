/**
 * Memory Consolidation Hook
 *
 * Automatically consolidates session memory when a session is reset via /new or /reset.
 * This hook schedules an isolated agent turn to summarize the previous session and
 * write the summary to memory files (memory/YYYY-MM-DD.md and optionally MEMORY.md).
 */

import type { SessionEntry } from "../config/sessions/types.js";
import type { CronJob, CronPayload } from "../cron/types.js";
import type { InternalHookEvent } from "./internal-hooks.js";
import { loadConfig } from "../config/config.js";
import { loadCronStore, resolveCronStorePath, saveCronStore } from "../cron/store.js";
import { logVerbose } from "../globals.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { registerInternalHook } from "./internal-hooks.js";

export interface MemoryConsolidationConfig {
  /** Enable memory consolidation on session reset. Default: false */
  enabled?: boolean;
  /**
   * The prompt to use for memory consolidation.
   * Available placeholders: {sessionId}, {sessionKey}, {date}
   */
  prompt?: string;
  /** Model to use for consolidation (defaults to agent default) */
  model?: string;
  /** Thinking level for consolidation */
  thinking?: string;
  /** Timeout in seconds for the consolidation turn */
  timeoutSeconds?: number;
}

const DEFAULT_PROMPT = `记忆整理任务：会话 {sessionId} 刚刚结束并被重置。

请执行：
1. 读取 session log (~/.openclaw/agents/main/sessions/{sessionId}.jsonl)
2. 提取关键对话、决策、事件
3. 写入 memory/{date}.md
4. 如有重要长期洞察，更新 MEMORY.md

保持简洁，只记有价值的信息。`;

/**
 * Register the memory consolidation hook.
 * Called once during gateway startup.
 */
export function registerMemoryConsolidationHook(): void {
  registerInternalHook("command:new", handleSessionReset);
  registerInternalHook("command:reset", handleSessionReset);
  logVerbose("[memory-consolidation] Hook registered for command:new and command:reset");
}

async function handleSessionReset(event: InternalHookEvent): Promise<void> {
  const cfg = loadConfig();
  const consolidationConfig = cfg.memory?.consolidation;

  // Check if memory consolidation is enabled
  if (!consolidationConfig?.enabled) {
    logVerbose("[memory-consolidation] Disabled, skipping");
    return;
  }

  const previousSessionEntry = event.context.previousSessionEntry as SessionEntry | undefined;
  if (!previousSessionEntry?.sessionId) {
    logVerbose("[memory-consolidation] No previous session to consolidate");
    return;
  }

  const sessionId = previousSessionEntry.sessionId;
  const sessionKey = event.sessionKey;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  logVerbose(`[memory-consolidation] Scheduling consolidation for session ${sessionId}`);

  const promptTemplate = consolidationConfig.prompt || DEFAULT_PROMPT;
  const prompt = promptTemplate
    .replace(/{sessionId}/g, sessionId)
    .replace(/{sessionKey}/g, sessionKey)
    .replace(/{date}/g, today);

  try {
    await scheduleConsolidationJob({
      sessionId,
      sessionKey,
      prompt,
      model: consolidationConfig.model,
      thinking: consolidationConfig.thinking,
      timeoutSeconds: consolidationConfig.timeoutSeconds ?? 120,
    });

    // Wake the cron scheduler to pick up the job immediately
    requestHeartbeatNow({ reason: "memory-consolidation" });
  } catch (err) {
    console.error(
      "[memory-consolidation] Failed to schedule:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function scheduleConsolidationJob(params: {
  sessionId: string;
  sessionKey: string;
  prompt: string;
  model?: string;
  thinking?: string;
  timeoutSeconds: number;
}): Promise<void> {
  const storePath = resolveCronStorePath();
  const store = await loadCronStore(storePath);

  const jobId = `memory-consolidation-${params.sessionId}`;
  const now = Date.now();

  // Remove any existing consolidation job for this session
  store.jobs = store.jobs.filter((j) => j.id !== jobId);

  const payload: CronPayload = {
    kind: "agentTurn",
    message: params.prompt,
    model: params.model,
    thinking: params.thinking,
    timeoutSeconds: params.timeoutSeconds,
  };

  const job: CronJob = {
    id: jobId,
    name: `Memory consolidation: ${params.sessionId.slice(0, 8)}`,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    // Schedule to run immediately (one-shot)
    schedule: { kind: "at", at: new Date(now).toISOString() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload,
    // Deliver result back to the user
    delivery: {
      mode: "announce",
    },
    state: { nextRunAtMs: now },
  };

  store.jobs.push(job);
  await saveCronStore(storePath, store);

  logVerbose(`[memory-consolidation] Scheduled job ${jobId}`);
}
