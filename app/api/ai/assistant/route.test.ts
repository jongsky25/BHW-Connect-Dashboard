import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantRoute } from "@/lib/ai/route";

const {
  getAdminUser,
  runToolLoop,
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
  internalTools,
  routeRequest,
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
  // Annotated at the union so a test may resolve a policy/scoped route without TypeScript having
  // narrowed the mock's signature to the default one.
  routeRequest: vi.fn(async (): Promise<AssistantRoute> => ({
    lane: "general",
    scope: null,
    output: "answer",
    confidence: "matched",
  })),
}));

vi.mock("@/lib/db/require-admin", () => ({ getAdminUser }));
vi.mock("@/lib/ai/agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/ai/rate-limit", () => ({
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
}));
vi.mock("@/lib/ai/dataset-tools", () => ({ createInternalTools: () => internalTools }));
// Increment 5.1. Mocked at the module boundary like every other dependency here: the router has
// its own suite (lib/ai/route-request.test.ts), and letting the real one run would put a Supabase
// client in the middle of a route test.
vi.mock("@/lib/ai/route-request", () => ({ routeRequest }));

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

/** The first event of a given type. Tests assert on the event they are about rather than on its
 * position, because the stream gained a leading `route` event in Increment 5.1 and will gain more
 * as later increments add output modes. */
function eventOfType(events: Record<string, unknown>[], type: string): Record<string, unknown> {
  const found = events.find((e) => e.type === type);
  if (!found)
    throw new Error(`no ${type} event in stream: ${events.map((e) => e.type).join(", ")}`);
  return found;
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
  routeRequest.mockClear().mockResolvedValue({
    lane: "general",
    scope: null,
    output: "answer",
    confidence: "matched",
  });
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

    expect(eventOfType(events, "tool_call")).toEqual({
      type: "tool_call",
      name: "queryDataset",
      args: { table: "agg_poverty", limit: 5 },
    });
    expect(eventOfType(events, "message")).toMatchObject({ type: "message", provider: "gemini" });
    // The tool call still precedes the answer it grounded.
    const types = events.map((e) => e.type);
    expect(types.indexOf("tool_call")).toBeLessThan(types.indexOf("message"));
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

    const event = eventOfType(await eventsOf(await POST(ask())), "message");

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

    const event = eventOfType(await eventsOf(await POST(ask())), "message");

    expect(event.content).toBe("Region VII has 3,891 profiled BHWs.");
  });

  it("reports capacity rather than answering when every provider is capped", async () => {
    runToolLoop.mockResolvedValue({
      finalText: null,
      toolPayloads: [],
      provider: null,
      allCapped: true,
    });

    const event = eventOfType(await eventsOf(await POST(ask())), "capacity");

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
      { citations: Record<string, unknown>[]; droppedPages: number[] } | undefined;

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

/**
 * Increment 5.1. The route is emitted before any tool runs, and it is not decoration: it is
 * concatenated into the system prompt, where it changes which tools the model reaches for.
 */
describe("POST /api/ai/assistant — the route (Increment 5.1)", () => {
  it("emits the route before the first tool call, so the chips render while the loop works", async () => {
    runToolLoop.mockImplementation(async (_m: unknown, onToolCall: (e: unknown) => void) => {
      onToolCall({ name: "queryDataset", args: {} });
      return { finalText: "Fine.", toolPayloads: [], provider: "gemini", allCapped: false };
    });
    const events = await eventsOf(await POST(ask()));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("route");
    expect(types.indexOf("route")).toBeLessThan(types.indexOf("tool_call"));
  });

  it("routes off the latest user turn, not the whole conversation", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Fine.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });
    const request = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "an answer" },
          { role: "user", content: "and its training coverage?" },
        ],
      }),
    });
    await POST(request);
    expect(routeRequest).toHaveBeenCalledWith("and its training coverage?", undefined, undefined);
  });

  // The route must change behaviour, not just label the answer — otherwise it is not worth
  // computing. The scope reaches the model as a resolved geo_code it is told not to re-search.
  it("concatenates the route into the single system message", async () => {
    routeRequest.mockResolvedValue({
      lane: "policy",
      scope: { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" },
      output: "answer",
      confidence: "matched",
    });
    runToolLoop.mockResolvedValue({
      finalText: "Fine.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });
    await POST(ask());

    const messages = runToolLoop.mock.calls[0][0] as { role: string; content: string }[];
    const systemMessages = messages.filter((m) => m.role === "system");
    // Exactly one: gemini.ts keeps the first system message and silently drops every later one.
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain("150701000");
    expect(systemMessages[0].content).toContain("supersedes");
    // ...without displacing the prompt it extends.
    expect(systemMessages[0].content).toContain("ONLY source of any number");
  });

  it("passes a pinned route through to the router", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Fine.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });
    const request = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "anything" }],
        pinnedRoute: { lane: "lineage" },
      }),
    });
    await POST(request);
    expect(routeRequest).toHaveBeenCalledWith("anything", { lane: "lineage" }, undefined);
  });

  it("passes the carried scope through as a separate argument, not as a pin", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Fine.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });
    const carriedScope = { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" };
    const request = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "and its training coverage?" }],
        carriedScope,
      }),
    });
    await POST(request);
    expect(routeRequest).toHaveBeenCalledWith(
      "and its training coverage?",
      undefined,
      carriedScope,
    );
  });

  it("rejects a carried scope whose geo level is not a real one", async () => {
    const request = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "anything" }],
        carriedScope: { geoCode: "150701000", geoLevel: "purok", geoName: "Basilan" },
      }),
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("rejects a pinned route whose lane is not one of the five", async () => {
    const request = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "anything" }],
        pinnedRoute: { lane: "sudo" },
      }),
    });
    expect((await POST(request)).status).toBe(400);
  });
});

/**
 * Increment 5.2. Follow-ups ride on the `message` event and are computed by a pure function from
 * the turn's tool payloads — the point being that a suggested question is a promise the assistant
 * can answer it, so it may only name things that came back this turn.
 */
describe("POST /api/ai/assistant — follow-ups (Increment 5.2)", () => {
  it("offers follow-ups built from the turn's payloads", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Poverty incidence there is 21.4%.",
      toolPayloads: [
        {
          table: "agg_poverty",
          grain: "one geography x SAE year",
          mode: "rows",
          rows: [{ poverty_incidence: 21.4 }],
        },
      ],
      provider: "gemini",
      allCapped: false,
    });

    const event = eventOfType(await eventsOf(await POST(ask())), "message");
    expect(event.followUps).toContain("Where does agg_poverty come from?");
  });

  it("never suggests a table the turn did not read", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Nothing to report.",
      toolPayloads: [{ error: "Table agg_secret is not registered." }],
      provider: "gemini",
      allCapped: false,
    });

    const event = eventOfType(await eventsOf(await POST(ask())), "message");
    expect(JSON.stringify(event.followUps)).not.toContain("agg_secret");
  });

  it("carries an empty list rather than omitting the field when nothing is groundable", async () => {
    routeRequest.mockResolvedValue({
      lane: "policy",
      scope: null,
      output: "answer",
      confidence: "matched",
    });
    runToolLoop.mockResolvedValue({
      finalText: "Nothing to report.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });

    const event = eventOfType(await eventsOf(await POST(ask())), "message");
    expect(event.followUps).toEqual([]);
  });
});

/**
 * Increment 5.5. The chart is built server-side from the tool payloads by a pure function; the
 * model chooses whether a chart is wanted (via the route), never what is in it.
 */
describe("POST /api/ai/assistant — figures (Increment 5.5)", () => {
  const distributionPayload = {
    parent: { geoCode: "07", geoLevel: "region", geoName: "Region VII" },
    indicator: { key: "pct_accredited", label: "% accredited", unit: "percent" },
    counts: { children: 2, withValue: 2, missing: 0, smallSample: 0 },
    highest: [
      { geoName: "Cebu", value: 70, nTotal: 900, smallSample: false },
      { geoName: "Bohol", value: 55, nTotal: 400, smallSample: false },
    ],
  };

  beforeEach(() => {
    runToolLoop.mockResolvedValue({
      finalText: "Cebu leads.",
      toolPayloads: [distributionPayload],
      provider: "gemini",
      allCapped: false,
    });
  });

  it("emits a figure whose values come from the payload when a chart was asked for", async () => {
    routeRequest.mockResolvedValue({
      lane: "geographic",
      scope: null,
      output: "chart",
      confidence: "matched",
    });

    const event = eventOfType(await eventsOf(await POST(ask())), "figure");
    expect(event.figure).toMatchObject({
      from: "getDistribution",
      data: [
        { label: "Cebu", value: 70 },
        { label: "Bohol", value: 55 },
      ],
    });
  });

  // A chart under every two-line answer is noise, not a feature.
  it("emits no figure for a plain answer", async () => {
    const events = await eventsOf(await POST(ask()));
    expect(events.some((e) => e.type === "figure")).toBe(false);
  });

  it("emits no figure when the payloads hold nothing plottable", async () => {
    routeRequest.mockResolvedValue({
      lane: "general",
      scope: null,
      output: "chart",
      confidence: "matched",
    });
    runToolLoop.mockResolvedValue({
      finalText: "Nothing to plot.",
      toolPayloads: [
        { table: "agg_poverty", grain: "one geography x SAE year", mode: "rows", rows: [] },
      ],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(ask()));
    expect(events.some((e) => e.type === "figure")).toBe(false);
  });

  it("sends the figure after the answer, so the prose settles first", async () => {
    routeRequest.mockResolvedValue({
      lane: "geographic",
      scope: null,
      output: "slide",
      confidence: "matched",
    });
    const types = (await eventsOf(await POST(ask()))).map((e) => e.type);
    expect(types.indexOf("message")).toBeLessThan(types.indexOf("figure"));
  });
});
