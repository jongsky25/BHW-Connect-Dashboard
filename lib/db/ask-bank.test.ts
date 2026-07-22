import { beforeEach, describe, expect, it, vi } from "vitest";

// A chainable query-builder stub: every method returns the same object, which is itself a
// thenable resolving to the configured `{ data, error }`. Lets us exercise the in-memory
// grouping/aggregation in ask-bank.ts without a live database.
const { state, createSupabaseServiceClient } = vi.hoisted(() => {
  const state = {
    result: { data: null as unknown, error: null as { message: string } | null },
    updates: [] as { values: Record<string, unknown>; key: string }[],
    deletes: [] as string[],
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "gte", "order", "limit", "in", "eq"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
  builder.update = (values: Record<string, unknown>) => ({
    eq: async (_col: string, key: string) => {
      state.updates.push({ values, key });
      return { error: null };
    },
  });
  builder.delete = () => ({
    eq: async (_col: string, key: string) => {
      state.deletes.push(key);
      return { error: null };
    },
  });
  const createSupabaseServiceClient = vi.fn(() => ({ from: () => builder }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { listFrequentQuestions, getAskCacheSavings, setAskBankStatus, updateAskBankAnswer, deleteAskBankEntry, isAskBankStatus } =
  await import("./ask-bank");

beforeEach(() => {
  state.result = { data: null, error: null };
  state.updates = [];
  state.deletes = [];
  createSupabaseServiceClient.mockClear();
});

describe("isAskBankStatus", () => {
  it("accepts only the three known statuses", () => {
    expect(isAskBankStatus("auto")).toBe(true);
    expect(isAskBankStatus("approved")).toBe(true);
    expect(isAskBankStatus("blocked")).toBe(true);
    expect(isAskBankStatus("deleted")).toBe(false);
    expect(isAskBankStatus(null)).toBe(false);
  });
});

describe("listFrequentQuestions", () => {
  it("groups by normalized question and counts asks, cache serves, and scopes", async () => {
    // Newest-first, as the query orders them.
    state.result = {
      data: [
        { question_norm: "how many bhws", question_raw: "How many BHWs?", geo_code: "07", served_from: "cache", created_at: "2026-07-22T03:00:00Z" },
        { question_norm: "how many bhws", question_raw: "how many bhws", geo_code: null, served_from: "cache_near", created_at: "2026-07-22T02:30:00Z" },
        { question_norm: "how many bhws", question_raw: "how many bhws", geo_code: null, served_from: "live", created_at: "2026-07-22T02:00:00Z" },
        { question_norm: "training gap", question_raw: "biggest training gap", geo_code: null, served_from: "live", created_at: "2026-07-22T01:00:00Z" },
      ],
      error: null,
    };
    const groups = await listFrequentQuestions();
    expect(groups).toHaveLength(2);

    const bhw = groups.find((g) => g.questionNorm === "how many bhws")!;
    expect(bhw.asks).toBe(3);
    expect(bhw.servedFromCache).toBe(1);
    expect(bhw.servedNear).toBe(1);
    expect(bhw.servedLive).toBe(1);
    expect(bhw.sample).toBe("How many BHWs?"); // newest raw phrasing
    expect(bhw.geoScopes.sort()).toEqual(["07", "national"]);

    // most-asked first
    expect(groups[0].questionNorm).toBe("how many bhws");
  });

  it("returns [] on a read error", async () => {
    state.result = { data: null, error: { message: "boom" } };
    expect(await listFrequentQuestions()).toEqual([]);
  });
});

describe("getAskCacheSavings", () => {
  it("splits chat events into live messages and cache hits", async () => {
    state.result = {
      data: [
        { event_type: "ai_chat_message" },
        { event_type: "ai_chat_cache_hit" },
        { event_type: "ai_chat_cache_hit" },
      ],
      error: null,
    };
    expect(await getAskCacheSavings()).toEqual({ liveMessages: 1, cacheHits: 2 });
  });

  it("returns zeroes on a read error", async () => {
    state.result = { data: null, error: { message: "boom" } };
    expect(await getAskCacheSavings()).toEqual({ liveMessages: 0, cacheHits: 0 });
  });
});

describe("mutations", () => {
  it("setAskBankStatus updates status by cache key", async () => {
    expect(await setAskBankStatus("k1", "blocked")).toBe(true);
    expect(state.updates).toEqual([{ values: { status: "blocked" }, key: "k1" }]);
  });

  it("updateAskBankAnswer writes the answer and pins it approved", async () => {
    expect(await updateAskBankAnswer("k1", "New answer.")).toBe(true);
    expect(state.updates).toEqual([{ values: { answer_md: "New answer.", status: "approved" }, key: "k1" }]);
  });

  it("deleteAskBankEntry removes by cache key", async () => {
    expect(await deleteAskBankEntry("k1")).toBe(true);
    expect(state.deletes).toEqual(["k1"]);
  });
});
