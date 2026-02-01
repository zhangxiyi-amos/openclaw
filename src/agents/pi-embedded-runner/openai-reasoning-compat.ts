import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";

const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

/**
 * Some OpenAI-compatible providers (e.g., Kimi/Moonshot) require `reasoning_content`
 * to be present on ALL assistant messages when thinking is enabled. The pi-ai library
 * only sets it on messages that have non-empty thinking blocks, causing 400 errors on
 * tool-call-only assistant messages that lack the field.
 *
 * This wrapper uses the `onPayload` hook to add `reasoning_content: ""` (or whichever
 * reasoning field is in use) to assistant messages that are missing it, but only when
 * at least one other assistant message already has it set.
 */
export function wrapStreamFnForReasoningConsistency(streamFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const prevOnPayload = options?.onPayload;
    const nextOnPayload = (payload: unknown) => {
      patchReasoningContent(payload);
      prevOnPayload?.(payload);
    };
    return streamFn(model as Model<Api>, context, {
      ...options,
      onPayload: nextOnPayload,
    });
  };
}

function patchReasoningContent(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const params = payload as { messages?: unknown[] };
  if (!Array.isArray(params.messages)) return;

  // Detect which reasoning field (if any) is already present on an assistant message.
  let usedField: string | null = null;
  for (const msg of params.messages) {
    if (!msg || typeof msg !== "object") continue;
    const record = msg as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    for (const field of REASONING_FIELDS) {
      if (field in record) {
        usedField = field;
        break;
      }
    }
    if (usedField) break;
  }

  if (!usedField) return;

  // Backfill the field on every assistant message that is missing it.
  for (const msg of params.messages) {
    if (!msg || typeof msg !== "object") continue;
    const record = msg as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    if (!(usedField in record)) {
      record[usedField] = "";
    }
  }
}
