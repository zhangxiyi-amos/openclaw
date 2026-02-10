/**
 * Session memory hook handler
 *
 * Notifies the main session to archive memories when /new command is triggered
 * Instead of writing files directly, sends a system event to let the agent decide what to save
 */

import type { HookHandler } from "../../hooks.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";

const log = createSubsystemLogger("hooks/session-memory");

/**
 * Notify main session to archive memories when /new command is triggered
 * Returns a system event payload instead of writing files directly
 */
const notifySessionMemory: HookHandler = async (event) => {
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

    log.info("Sending memory archive notification", { sessionId });

    // Return a system event to inject into the session
    // The agent will decide what to archive based on its full context
    return {
      systemEvent: {
        text: `Session ended. Review the previous conversation and archive important content to memory/YYYY-MM-DD.md (today's date). Focus on decisions, lessons, and meaningful events. Skip trivial exchanges. If nothing worth saving, reply NO_REPLY.`,
        metadata: {
          hook: "session-memory",
          sessionId,
          sessionFile,
        },
      },
    };
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to send memory notification", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to send memory notification", { error: String(err) });
    }
  }
};

export default notifySessionMemory;
