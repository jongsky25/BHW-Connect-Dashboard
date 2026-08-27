import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./providers/types";

const mocks = vi.hoisted(() => ({ completeWithCascade: vi.fn() }));
vi.mock("./quota", () => ({ completeWithCascade: mocks.completeWithCascade }));

const { runToolLoop } = await import("./agent-loop");

/** A single-tool set whose execute() just echoes its args back — enough to drive the loop
 * through a real round without depending on any real tool's behavior. */
const ECHO_TOOLS = [
  {
    definition: { name: "echo", description: "", parameters: { type: "object" as const, properties: {} } },
    execute: vi.fn(async (args: Record<string, unknown>) => ({ echoed: args })),
  },
];

function completion(content: string | null, toolCalls: unknown[] = []) {
  return { allCapped: false as const, provider: "gemini" as const, completion: { content, toolCalls } };
}

function toolCall(name: string, args: Record<string, unknown> = {}) {
  return { id: "call-1", name, arguments: args };
}

beforeEach(() => {
  mocks.completeWithCascade.mockReset();
  ECHO_TOOLS[0].execute.mockClear();
});

/**
 * `runToolLoop`'s round budget and its forced wrap-up (docs/DECISIONS.md, the "9 tool calls, no
 * answer" investigation). Live evidence showed a clean, error-free Gemini completion returning
 * genuinely empty content on the wrap-up call — not a rate limit, not a fallback, not a thrown
 * error — so these tests exercise the two things that actually changed: the wrap-up now tells the
 * model in the same turn that it must answer, and an empty reply gets one retry with a stronger
 * nudge before the loop gives up.
 */
describe("runToolLoop", () => {
  it("returns immediately when the model answers with no tool calls", async () => {
    mocks.completeWithCascade.mockResolvedValueOnce(completion("a plain answer"));
    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(result).toEqual({
      finalText: "a plain answer",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });
    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(1);
  });

  it("executes a requested tool call and feeds the result back before asking again", async () => {
    mocks.completeWithCascade
      .mockResolvedValueOnce(completion(null, [toolCall("echo", { q: "x" })]))
      .mockResolvedValueOnce(completion("done"));
    const onToolCall = vi.fn();
    const result = await runToolLoop([{ role: "user", content: "hi" }], onToolCall, ECHO_TOOLS);

    expect(onToolCall).toHaveBeenCalledWith({ name: "echo", args: { q: "x" } });
    expect(result.toolPayloads).toEqual([{ echoed: { q: "x" } }]);
    expect(result.finalText).toBe("done");

    // The second call's messages carry the tool result, so the model actually saw it.
    const secondCallMessages = mocks.completeWithCascade.mock.calls[1][0] as ChatMessage[];
    expect(secondCallMessages).toContainEqual({
      role: "tool",
      toolCallId: "call-1",
      name: "echo",
      content: JSON.stringify({ echoed: { q: "x" } }),
    });
  });

  it("stops requesting tools after the round cap and forces a wrap-up call", async () => {
    // Every round returns a tool call, so the model never voluntarily stops — this is the shape
    // that burned 9 tool calls in production. 4 rounds + 1 forced wrap-up = 5 calls.
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion("wrapped up"));

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);

    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(5);
    expect(result.finalText).toBe("wrapped up");
    // The forced call withdraws every tool.
    expect(mocks.completeWithCascade.mock.calls[4][1]).toEqual([]);
  });

  it("tells the model as a USER turn that this call must answer, never a second system message", async () => {
    // The bug this guards against is provider-specific and silent: lib/ai/providers/gemini.ts
    // keeps only the first system-role message it finds and drops every later one from the
    // request entirely, so a nudge sent as `role: "system"` would never reach Gemini at all —
    // which is the exact provider that produced the empty completion in production.
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion("wrapped up"));

    await runToolLoop(
      [
        { role: "system", content: "SYSTEM PROMPT" },
        { role: "user", content: "hi" },
      ],
      undefined,
      ECHO_TOOLS,
    );

    const wrapUpMessages = mocks.completeWithCascade.mock.calls[4][0] as ChatMessage[];
    const last = wrapUpMessages[wrapUpMessages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("No further tool calls are available");
    // Still exactly one system message in the whole array — the nudge did not add a second one.
    expect(wrapUpMessages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("retries once, with a stronger nudge, when the wrap-up call returns empty text", async () => {
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion("")); // the observed failure
    mocks.completeWithCascade.mockResolvedValueOnce(completion("recovered on retry"));

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);

    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(6);
    expect(result.finalText).toBe("recovered on retry");

    const retryMessages = mocks.completeWithCascade.mock.calls[5][0] as ChatMessage[];
    const last = retryMessages[retryMessages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("Your previous reply had no text in it");
    // The empty completion the model just gave is in history, so the retry is informed by it
    // rather than repeating the exact same request that already failed.
    expect(retryMessages.at(-2)).toEqual({ role: "assistant", content: "", toolCalls: [] });
  });

  it("treats a whitespace-only wrap-up reply the same as a truly empty one", async () => {
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion("   \n  "));
    mocks.completeWithCascade.mockResolvedValueOnce(completion("recovered"));

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(6);
    expect(result.finalText).toBe("recovered");
  });

  it("gives up after one retry rather than looping indefinitely", async () => {
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion(""));
    mocks.completeWithCascade.mockResolvedValueOnce(completion(null)); // still nothing

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(6);
    expect(result.finalText).toBeNull();
  });

  it("reports allCapped when every provider is capped mid-round", async () => {
    mocks.completeWithCascade.mockResolvedValueOnce({ allCapped: true, provider: null });
    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(result).toEqual({ finalText: null, toolPayloads: [], provider: null, allCapped: true });
  });

  it("reports allCapped when every provider is capped on the forced wrap-up call", async () => {
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce({ allCapped: true, provider: null });

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(result.allCapped).toBe(true);
    expect(result.finalText).toBeNull();
    // Nothing else calls completeWithCascade after allCapped is seen -- no retry attempted.
    expect(mocks.completeWithCascade).toHaveBeenCalledTimes(5);
  });

  it("reports allCapped when every provider is capped on the retry call", async () => {
    for (let i = 0; i < 4; i++) {
      mocks.completeWithCascade.mockResolvedValueOnce(completion(null, [toolCall("echo")]));
    }
    mocks.completeWithCascade.mockResolvedValueOnce(completion(""));
    mocks.completeWithCascade.mockResolvedValueOnce({ allCapped: true, provider: null });

    const result = await runToolLoop([{ role: "user", content: "hi" }], undefined, ECHO_TOOLS);
    expect(result.allCapped).toBe(true);
    expect(result.finalText).toBeNull();
  });
});
