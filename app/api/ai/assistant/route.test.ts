import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminUser,
  runToolLoop,
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
  internalTools,
} = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  runToolLoop: vi.fn(),
  isInternalAssistantRateLimited: vi.fn(),
  recordInternalAssistantMessage: vi.fn(),
  internalTools: [
    {
      definition: {
        name: "queryDataset",
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      execute: vi.fn(),
    },
  ],
}));

vi.mock("@/lib/db/require-admin", () => ({ getAdminUser }));
vi.mock("@/lib/ai/agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/ai/rate-limit", () => ({
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
}));
vi.mock("@/lib/ai/dataset-tools", () => ({ createInternalTools: () => internalTools }));

const { POST } = await import("./route");

const ADMIN = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "staff@example.gov.ph",
  role: "admin" as const,
};

function ask(question = "How many provinces are on the UUC list?"): Request {
  return new Request("http://localhost/api/ai/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
}

/** Collects the NDJSON events a streamed response emits. */
async function eventsOf(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  getAdminUser.mockReset().mockResolvedValue(ADMIN);
  runToolLoop.mockReset();
  isInternalAssistantRateLimited.mockReset().mockResolvedValue(false);
  recordInternalAssistantMessage.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/ai/assistant — the admin boundary", () => {
  it("refuses an anonymous request with 401 and never reaches a provider", async () => {
    getAdminUser.mockResolvedValue(null);

    const response = await POST(ask());

    expect(response.status).toBe(401);
    expect(runToolLoop).not.toHaveBeenCalled();
    // The check happens before the body is even parsed: nothing about the request should be able
    // to influence whether the gate opens.
    expect(recordInternalAssistantMessage).not.toHaveBeenCalled();
  });

  it("checks the admin session on the route itself, not only on the page", async () => {
    await POST(ask());
    expect(getAdminUser).toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/assistant", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(400);
    expect(runToolLoop).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/assistant — limits and tool set", () => {
  it("returns 429 once the admin's own limit is reached, without calling a provider", async () => {
    isInternalAssistantRateLimited.mockResolvedValue(true);

    const response = await POST(ask());

    expect(response.status).toBe(429);
    expect(isInternalAssistantRateLimited).toHaveBeenCalledWith(ADMIN.id);
    expect(runToolLoop).not.toHaveBeenCalled();
  });

  it("runs the loop with the internal tool set and the internal system prompt", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "No figures here.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });

    await POST(ask());

    const [messages, , tools] = runToolLoop.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("internal data assistant");
    expect(tools).toBe(internalTools);
    expect(recordInternalAssistantMessage).toHaveBeenCalledWith(ADMIN.id);
  });

  it("streams each tool call with its arguments, then the answer", async () => {
    runToolLoop.mockImplementation(async (_messages: unknown, onToolCall: (e: unknown) => void) => {
      onToolCall({ name: "queryDataset", args: { table: "agg_poverty", limit: 5 } });
      return {
        finalText: "Poverty data covers city and municipality level only.",
        toolPayloads: [{ rows: [] }],
        provider: "gemini",
        allCapped: false,
      };
    });

    const events = await eventsOf(await POST(ask()));

    expect(events[0]).toEqual({
      type: "tool_call",
      name: "queryDataset",
      args: { table: "agg_poverty", limit: 5 },
    });
    expect(events[1]).toMatchObject({ type: "message", provider: "gemini" });
  });
});

describe("POST /api/ai/assistant — grounding is not relaxed", () => {
  it("strips a sentence whose number is in no tool payload", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Region VII has 4,210 profiled BHWs. Coverage is uneven across its provinces.",
      toolPayloads: [{ rows: [{ geo_code: "07", n_total: 3891 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event.content).toBe("Coverage is uneven across its provinces.");
    expect(event.content).not.toContain("4,210");
  });

  it("keeps a figure that is in a tool payload", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Region VII has 3,891 profiled BHWs.",
      toolPayloads: [{ rows: [{ geo_code: "07", n_total: 3891 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event.content).toBe("Region VII has 3,891 profiled BHWs.");
  });

  it("reports capacity rather than answering when every provider is capped", async () => {
    runToolLoop.mockResolvedValue({
      finalText: null,
      toolPayloads: [],
      provider: null,
      allCapped: true,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event).toMatchObject({ type: "capacity" });
  });
});

describe("POST /api/ai/assistant — citations (Increment 2.3)", () => {
  /**
   * These run the REAL `collectCitations` and `auditCitations` through the route, the same way the
   * grounding tests run the real `auditNarrative`. Mocking them would test that the route calls two
   * functions, which is not the claim §7 makes; the claim is that a fabricated page does not reach
   * the reader and a real one arrives with the passage behind it.
   */
  function searchPayload(...pages: number[]) {
    return {
      query: "deadline",
      count: pages.length,
      retrieval: { lexical: true, vector: false },
      warnings: [],
      results: pages.map((page) => ({
        chunkId: page - 1,
        document: "blhsd-2027-budget-cue-cards",
        documentTitle: "[BLHSD] 2027 Budget Cue Cards",
        asOf: "2025-09-18",
        page,
        heading: "FAQs",
        text: `text of slide ${page}`,
        truncated: false,
        charStart: 100 * page,
        charEnd: 100 * page + 40,
        citation: `[BLHSD] 2027 Budget Cue Cards, slide ${page}`,
      })),
    };
  }

  it("emits the retrieved passages as citations, with the text and offsets behind them", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "The cue cards describe the FAQ section on slide 26.",
      toolPayloads: [searchPayload(26)],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const citations = events.find((e) => e.type === "citations") as
      | { citations: Record<string, unknown>[]; droppedPages: number[] }
      | undefined;

    expect(citations?.citations).toHaveLength(1);
    expect(citations?.citations[0]).toMatchObject({
      chunkId: 25,
      page: 26,
      label: "[BLHSD] 2027 Budget Cue Cards, slide 26",
      text: "text of slide 26",
      charStart: 2600,
      asOf: "2025-09-18",
    });
    expect(citations?.droppedPages).toEqual([]);
  });

  it("drops a sentence citing a slide no search returned, and says which", async () => {
    runToolLoop.mockResolvedValue({
      finalText:
        "The FAQ section begins on slide 26. A highly technical request has a 20-working-day deadline, per slide 42.",
      toolPayloads: [searchPayload(26)],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const message = events.find((e) => e.type === "message") as { content: string };
    const citations = events.find((e) => e.type === "citations") as { droppedPages: number[] };

    expect(message.content).toContain("slide 26");
    expect(message.content).not.toContain("slide 42");
    expect(message.content).not.toContain("20-working-day");
    expect(citations.droppedPages).toEqual([42]);
  });

  it("explains itself when every sentence cited a fabricated slide", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Slide 42 sets a 20-working-day deadline.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const message = events.find((e) => e.type === "message") as { content: string };

    // A document claim made without ever opening a document is the worst case, and must not
    // reach the reader as a bare "no answer".
    expect(message.content).toContain("42");
    expect(message.content).toContain("no document search");
  });

  it("emits no citations event for an answer that used no documents", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Region VII has 41052 records.",
      toolPayloads: [{ table: "agg_bhw_counts", rows: [{ n: 41052 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    expect(events.find((e) => e.type === "citations")).toBeUndefined();
  });

  it("keeps the numeric audit in force alongside the citation audit", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Slide 26 states 277767 BHWs. Region VII has 99999 records.",
      toolPayloads: [searchPayload(26), { table: "agg_bhw_counts", rows: [{ n: 277767 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const message = events.find((e) => e.type === "message") as { content: string };

    // Slide 26 was retrieved and 277767 is in a payload, so the first sentence passes both
    // audits. 99999 is in neither, so the numeric audit still drops the second — the citation
    // pass running first does not weaken it.
    expect(message.content).toContain("Slide 26");
    expect(message.content).not.toContain("99999");
  });

  it("blames the citation pass, not the numeric one, when a page is fabricated", async () => {
    // A slide number is a number, so without ordering these deliberately the numeric audit
    // strips "slide 42" for containing an untraceable 42 and the reader is told the figures were
    // ungrounded — true, but not the useful thing to say about a fabricated citation.
    runToolLoop.mockResolvedValue({
      finalText: "The deadline is set on slide 42.",
      toolPayloads: [searchPayload(26)],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const citations = events.find((e) => e.type === "citations") as { droppedPages: number[] };
    expect(citations.droppedPages).toEqual([42]);
  });

  it("catches a fabricated page even when that number appears in another payload", async () => {
    // The case where the citation pass is genuinely load-bearing: 42 is a legitimate figure
    // somewhere in the results, so the numeric audit has no objection to it.
    runToolLoop.mockResolvedValue({
      finalText: "The deadline is set on slide 42.",
      toolPayloads: [searchPayload(26), { table: "agg_workload", rows: [{ caseload: 42 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    const message = events.find((e) => e.type === "message") as { content: string };
    const citations = events.find((e) => e.type === "citations") as { droppedPages: number[] };

    expect(citations.droppedPages).toEqual([42]);
    expect(message.content).not.toContain("slide 42");
  });
});
