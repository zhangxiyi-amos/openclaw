import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";

export type MemoryConsolidationConfig = {
  /**
   * Enable automatic memory consolidation when a session is reset via /new or /reset.
   * When enabled, an isolated agent turn will summarize the previous session
   * and write to memory files (memory/YYYY-MM-DD.md and optionally MEMORY.md).
   * Default: false
   */
  enabled?: boolean;
  /**
   * Custom prompt for memory consolidation.
   * Available placeholders: {sessionId}, {sessionKey}, {date}
   */
  prompt?: string;
  /** Model to use for consolidation (defaults to agent default) */
  model?: string;
  /** Thinking level for consolidation */
  thinking?: string;
  /** Timeout in seconds for the consolidation turn. Default: 120 */
  timeoutSeconds?: number;
};

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
  /**
   * Automatic memory consolidation on session reset.
   * Summarizes the previous session and writes to memory files.
   */
  consolidation?: MemoryConsolidationConfig;
};

export type MemoryQmdConfig = {
  command?: string;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
