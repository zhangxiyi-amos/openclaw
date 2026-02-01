import { describe, expect, it, vi } from "vitest";
import { wrapStreamFnForReasoningConsistency } from "./openai-reasoning-compat.js";

describe("wrapStreamFnForReasoningConsistency", () => {
  it("backfills reasoning_content on assistant messages that lack it", () => {
    let capturedPayload: unknown;
    const fakeStream = { push: vi.fn(), end: vi.fn() };
    const baseFn = vi.fn(
      (_model: unknown, _ctx: unknown, options?: { onPayload?: (p: unknown) => void }) => {
        const payload = {
          messages: [
            { role: "system", content: "you are helpful" },
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi", reasoning_content: "I should greet" },
            { role: "user", content: "use a tool" },
            // This assistant message has tool_calls but no reasoning_content
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "1", type: "function", function: { name: "foo", arguments: "{}" } },
              ],
            },
            { role: "tool", content: "result", tool_call_id: "1" },
            { role: "user", content: "thanks" },
            // Another assistant without reasoning_content
            { role: "assistant", content: "you're welcome" },
          ],
        };
        options?.onPayload?.(payload);
        capturedPayload = payload;
        return fakeStream;
      },
    );

    const wrapped = wrapStreamFnForReasoningConsistency(baseFn as any);
    wrapped({} as any, {} as any, {});

    const messages = (capturedPayload as any).messages;
    // The tool-call assistant at index 4 should now have reasoning_content
    expect(messages[4]).toHaveProperty("reasoning_content", "");
    // The final assistant at index 7 should also have it
    expect(messages[7]).toHaveProperty("reasoning_content", "");
    // The original one should be unchanged
    expect(messages[2].reasoning_content).toBe("I should greet");
    // Non-assistant messages should not be touched
    expect(messages[0]).not.toHaveProperty("reasoning_content");
    expect(messages[1]).not.toHaveProperty("reasoning_content");
  });

  it("does nothing when no assistant message has reasoning fields", () => {
    let capturedPayload: unknown;
    const fakeStream = { push: vi.fn(), end: vi.fn() };
    const baseFn = vi.fn(
      (_model: unknown, _ctx: unknown, options?: { onPayload?: (p: unknown) => void }) => {
        const payload = {
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "1", type: "function", function: { name: "foo", arguments: "{}" } },
              ],
            },
          ],
        };
        options?.onPayload?.(payload);
        capturedPayload = payload;
        return fakeStream;
      },
    );

    const wrapped = wrapStreamFnForReasoningConsistency(baseFn as any);
    wrapped({} as any, {} as any, {});

    const messages = (capturedPayload as any).messages;
    expect(messages[1]).not.toHaveProperty("reasoning_content");
    expect(messages[2]).not.toHaveProperty("reasoning_content");
  });

  it("chains previous onPayload callback", () => {
    const fakeStream = { push: vi.fn(), end: vi.fn() };
    const prevOnPayload = vi.fn();
    const baseFn = vi.fn(
      (_model: unknown, _ctx: unknown, options?: { onPayload?: (p: unknown) => void }) => {
        options?.onPayload?.({ messages: [] });
        return fakeStream;
      },
    );

    const wrapped = wrapStreamFnForReasoningConsistency(baseFn as any);
    wrapped({} as any, {} as any, { onPayload: prevOnPayload } as any);

    expect(prevOnPayload).toHaveBeenCalledTimes(1);
  });

  it("handles 'reasoning' field variant", () => {
    let capturedPayload: unknown;
    const fakeStream = { push: vi.fn(), end: vi.fn() };
    const baseFn = vi.fn(
      (_model: unknown, _ctx: unknown, options?: { onPayload?: (p: unknown) => void }) => {
        const payload = {
          messages: [
            { role: "assistant", content: "hi", reasoning: "thought process" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "1", type: "function", function: { name: "foo", arguments: "{}" } },
              ],
            },
          ],
        };
        options?.onPayload?.(payload);
        capturedPayload = payload;
        return fakeStream;
      },
    );

    const wrapped = wrapStreamFnForReasoningConsistency(baseFn as any);
    wrapped({} as any, {} as any, {});

    const messages = (capturedPayload as any).messages;
    expect(messages[1]).toHaveProperty("reasoning", "");
    expect(messages[1]).not.toHaveProperty("reasoning_content");
  });
});
