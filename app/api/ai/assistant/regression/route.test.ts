import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminUser, recordRegressionCase } = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  recordRegressionCase: vi.fn(),
}));

vi.mock("@/lib/db/require-admin", () => ({ getAdminUser }));
vi.mock("@/lib/db/regression-cases", () => ({ recordRegressionCase }));

const { POST } = await import("./route");

const ADMIN = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "staff@example.gov.ph",
  role: "admin" as const,
};

/** A complete, valid report — the shape the assistant UI actually sends. */
function report(over: Record<string, unknown> = {}) {
  return {
    question: "How many BHWs are there?",
    conversation: [
      { role: "user", content: "How many BHWs are there?" },
      { role: "assistant", content: "The cue cards state 277,767 as of Dec 2025." },
    ],
    answerGiven: "The cue cards state 277,767 as of Dec 2025.",
    toolCalls: [{ name: "searchDocuments", args: { query: "How many BHWs are there" } }],
    citations: [{ chunkId: 26, page: 26, label: "Cue Cards, slide 26" }],
    provider: "gemini",
    note: "Should have given the SQL figure too — 270,917 profiled records.",
    ...over,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/assistant/regression", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getAdminUser.mockReset().mockResolvedValue(ADMIN);
  recordRegressionCase.mockReset().mockResolvedValue(7);
});

describe("POST /api/ai/assistant/regression — the admin boundary", () => {
  it("refuses an anonymous report with 401 and writes nothing", async () => {
    getAdminUser.mockResolvedValue(null);
    const response = await POST(post(report()));

    expect(response.status).toBe(401);
    expect(recordRegressionCase).not.toHaveBeenCalled();
  });

  it("checks the admin session before parsing the body", async () => {
    // The gate must not depend on anything in the request: proxy.ts never sees /api/*, so this
    // route is the security boundary (same reasoning as Increment 1.4).
    getAdminUser.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/ai/assistant/regression", {
        method: "POST",
        body: "not json at all",
      }),
    );

    expect(response.status).toBe(401);
    expect(recordRegressionCase).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/assistant/regression — what a case stores", () => {
  it("stores everything a replay needs, attributed to the reporter", async () => {
    const response = await POST(post(report()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ caseId: 7 });

    const stored = recordRegressionCase.mock.calls[0][0];
    // The whole conversation, not just the question: the assistant is multi-turn and an answer
    // often depends on what came before it.
    expect(stored.conversation).toHaveLength(2);
    // Tool calls with their arguments — a later build answering the same question via different
    // tools has changed behaviour even when the prose looks similar.
    expect(stored.toolCalls).toEqual([
      { name: "searchDocuments", args: { query: "How many BHWs are there" } },
    ]);
    expect(stored.citations).toHaveLength(1);
    expect(stored.provider).toBe("gemini");
    expect(stored.reportedBy).toBe(ADMIN.id);
  });

  it("accepts a report with no note — knowing it is wrong is enough to file it", async () => {
    await POST(post(report({ note: null })));
    expect(recordRegressionCase.mock.calls[0][0].note).toBeNull();
  });

  it("treats a whitespace-only note as no note", async () => {
    await POST(post(report({ note: "   " })));
    expect(recordRegressionCase.mock.calls[0][0].note).toBeNull();
  });

  it("accepts an answer that used no tools and cited nothing", async () => {
    const response = await POST(post(report({ toolCalls: [], citations: [], provider: null })));
    expect(response.status).toBe(200);
    expect(recordRegressionCase.mock.calls[0][0].toolCalls).toEqual([]);
  });

  it("rejects a malformed body with 400 rather than storing a partial case", async () => {
    const response = await POST(post({ question: "only this" }));
    expect(response.status).toBe(400);
    expect(recordRegressionCase).not.toHaveBeenCalled();
  });

  it("says plainly when the write did not land", async () => {
    // Telling a reader "recorded" when nothing was saved is how a regression list stops growing.
    recordRegressionCase.mockResolvedValue(null);
    const response = await POST(post(report()));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("nothing was saved");
  });
});
