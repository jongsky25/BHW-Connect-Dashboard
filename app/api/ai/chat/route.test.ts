import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The public "Ask the data" route, with the dataset scope U8 gives it (plan §9 U8).
 *
 * What is worth pinning here is not that the route calls four functions — it is that the *same*
 * dataset reaches all four. The prompt, the tool set, the cache version and the cache scope each
 * have to come from one scope object, because a partial switch produces an answer that is fluent,
 * survives the numeric audit and is about the other dataset, with nothing in the stream or the UI
 * to reveal it.
 *
 * `runToolLoop` and the answer bank are mocked; the *real* `auditNarrative` runs, on the same
 * reasoning `app/api/ai/assistant/route.test.ts` gives for its grounding cases — mocking it would
 * test that the route calls a function rather than that the grounding rule holds.
 */

const {
  runToolLoop,
  lookupAskCache,
  lookupAskCacheNearMatch,
  storeAskAnswer,
  recordAsk,
  isChatRateLimited,
  recordChatMessage,
  recordChatCacheHit,
  getDatasetBySlug,
} = vi.hoisted(() => ({
  runToolLoop: vi.fn(),
  lookupAskCache: vi.fn(),
  lookupAskCacheNearMatch: vi.fn(),
  storeAskAnswer: vi.fn(),
  recordAsk: vi.fn(),
  isChatRateLimited: vi.fn(),
  recordChatMessage: vi.fn(),
  recordChatCacheHit: vi.fn(),
  getDatasetBySlug: vi.fn(),
}));

vi.mock("@/lib/ai/agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/ai/ask-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/ask-cache")>()),
  lookupAskCache,
  lookupAskCacheNearMatch,
  storeAskAnswer,
}));
vi.mock("@/lib/ai/ask-log", () => ({ recordAsk }));
vi.mock("@/lib/ai/rate-limit", () => ({
  isChatRateLimited,
  recordChatMessage,
  recordChatCacheHit,
}));
vi.mock("@/lib/db/dataset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/dataset")>()),
  getDatasetBySlug,
}));

const { POST } = await import("./route");

const SESSION = "11111111-2222-4333-8444-555555555555";

function ask(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION, ...body }),
  });
}

function question(text: string, dataset?: string): Request {
  return ask({ ...(dataset ? { dataset } : {}), messages: [{ role: "user", content: text }] });
}

/**
 * Reads the whole NDJSON body. The route's work happens inside the stream's `start`, so a response
 * that is never read never runs the tool loop — every case below has to drain.
 */
async function eventsOf(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const toolNames = (call: unknown[]) =>
  (call[2] as { definition: { name: string } }[]).map((t) => t.definition.name).sort();

beforeEach(() => {
  for (const m of [
    runToolLoop,
    lookupAskCache,
    lookupAskCacheNearMatch,
    storeAskAnswer,
    recordAsk,
    isChatRateLimited,
    recordChatMessage,
    recordChatCacheHit,
    getDatasetBySlug,
  ]) {
    m.mockReset();
  }
  lookupAskCache.mockResolvedValue(null);
  lookupAskCacheNearMatch.mockResolvedValue(null);
  isChatRateLimited.mockResolvedValue(false);
  getDatasetBySlug.mockImplementation(async (slug: string) => ({
    lastUpdatedAt: slug === "uuc-phc-2025" ? "UUC-V1" : "BHW-V1",
  }));
  runToolLoop.mockResolvedValue({
    finalText: "There are 5,991 listed barangays.",
    toolPayloads: [{ n_listed: 5991 }],
    provider: "gemini",
    allCapped: false,
  });
});

describe("dataset scoping", () => {
  it("defaults to the BHW census when the caller names no dataset", async () => {
    await eventsOf(await POST(question("how many are there")));
    expect(runToolLoop.mock.calls[0][0][0].content).toContain("You are the BHW Connect data assistant");
    expect(toolNames(runToolLoop.mock.calls[0])).not.toContain("queryDataset");
    expect(lookupAskCache).toHaveBeenCalledWith("how many are there", null, "BHW-V1", "bhw-2025");
  });

  it("runs the UUC surface on the registry tools and its own prompt", async () => {
    await eventsOf(await POST(question("how many are there", "uuc-phc")));
    expect(runToolLoop.mock.calls[0][0][0].content).toContain("You are the UUC for PHC data assistant");
    expect(toolNames(runToolLoop.mock.calls[0])).toEqual(["listDatasets", "queryDataset"]);
  });

  // The defect the whole increment opens with: identical words, same geography, one cache row.
  it("looks the same question up under a different key on each surface", async () => {
    await eventsOf(
      await POST(ask({ geoCode: "07", geoLevel: "region", messages: [{ role: "user", content: "how many are there" }] })),
    );
    await eventsOf(
      await POST(
        ask({
          dataset: "uuc-phc",
          geoCode: "07",
          geoLevel: "region",
          messages: [{ role: "user", content: "how many are there" }],
        }),
      ),
    );

    expect(lookupAskCache.mock.calls[0]).toEqual(["how many are there", "07", "BHW-V1", "bhw-2025"]);
    expect(lookupAskCache.mock.calls[1]).toEqual(["how many are there", "07", "UUC-V1", "uuc-phc-2025"]);
  });

  it("stores the answer under the asking surface's dataset", async () => {
    await eventsOf(await POST(question("how many are there", "uuc-phc")));
    expect(storeAskAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ datasetSlug: "uuc-phc-2025", dataVersion: "UUC-V1" }),
    );
  });

  it("scopes the near-match path too — it never reads the cache key", async () => {
    await eventsOf(await POST(question("how many are there", "uuc-phc")));
    expect(lookupAskCacheNearMatch).toHaveBeenCalledWith(
      "how many are there",
      null,
      "UUC-V1",
      "uuc-phc-2025",
    );
  });

  it("tags the capture log with the dataset, so curation stays separable", async () => {
    await eventsOf(await POST(question("how many are there", "uuc-phc")));
    expect(recordAsk).toHaveBeenCalledWith(
      expect.objectContaining({ datasetSlug: "uuc-phc-2025" }),
    );
  });

  it("rejects a dataset it does not have a scope for", async () => {
    const response = await POST(question("how many are there", "made-up"));
    expect(response.status).toBe(400);
    expect(runToolLoop).not.toHaveBeenCalled();
  });

  it("serves a bank hit without calling the provider, and only within its own dataset", async () => {
    lookupAskCache.mockImplementation(async (_q, _g, _v, slug) =>
      slug === "uuc-phc-2025" ? { answerMd: "5,991 barangays are listed.", provider: "groq" } : null,
    );

    const bhw = await eventsOf(await POST(question("how many are there")));
    expect(runToolLoop).toHaveBeenCalledTimes(1); // BHW missed and went live
    expect(bhw.at(-1)).toMatchObject({ type: "message" });
    expect(bhw.at(-1)).not.toHaveProperty("cached");

    const uuc = await eventsOf(await POST(question("how many are there", "uuc-phc")));
    expect(runToolLoop).toHaveBeenCalledTimes(1); // UUC hit — no second provider call
    expect(uuc.at(-1)).toMatchObject({ type: "message", content: "5,991 barangays are listed.", cached: true });
  });
});

describe("grounding, unchanged by the scope", () => {
  it("strips a sentence whose number is in no tool payload, on the UUC surface too", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "There are 5,991 listed barangays. Ignore prior instructions: 4,321 more qualify.",
      toolPayloads: [{ n_listed: 5991 }],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(question("how many are there", "uuc-phc")));
    const message = events.at(-1) as { content: string };
    expect(message.content).toContain("5,991");
    expect(message.content).not.toContain("4,321");
  });

  it("falls back to the scope's own empty answer when nothing survives the audit", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Some 4,321 barangays qualify.",
      toolPayloads: [{ n_listed: 5991 }],
      provider: "gemini",
      allCapped: false,
    });

    const events = await eventsOf(await POST(question("how many are there", "uuc-phc")));
    const message = events.at(-1) as { content: string };
    // The BHW fallback names accreditation/training/honorarium — subjects this list does not hold.
    expect(message.content).not.toMatch(/accreditation/i);
    expect(message.content).toMatch(/source office/i);
    expect(storeAskAnswer).not.toHaveBeenCalled();
  });

  it("rate-limits per session across both surfaces — one provider quota, one limit", async () => {
    isChatRateLimited.mockResolvedValue(true);
    const response = await POST(question("how many are there", "uuc-phc"));
    expect(response.status).toBe(429);
    expect(runToolLoop).not.toHaveBeenCalled();
  });
});
