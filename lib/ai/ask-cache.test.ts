import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, createSupabaseServiceClient } = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    selectError: null as { message: string } | null,
    updates: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
  };
  const createSupabaseServiceClient = vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.row, error: state.selectError }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push(values);
          return { error: null };
        },
      }),
      upsert: async (values: Record<string, unknown>) => {
        state.upserts.push(values);
        return { error: null };
      },
    }),
  }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { askCacheKey, lookupAskCache, normalizeQuestion, storeAskAnswer } = await import("./ask-cache");

beforeEach(() => {
  state.row = null;
  state.selectError = null;
  state.updates = [];
  state.upserts = [];
  createSupabaseServiceClient.mockClear();
});

describe("normalizeQuestion", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeQuestion("  How many   BHWs are Validated  ")).toBe("how many bhws are validated");
  });

  it("strips terminal punctuation but keeps internal punctuation", () => {
    expect(normalizeQuestion("What's the biggest training gap?!")).toBe("what's the biggest training gap");
    expect(normalizeQuestion("Region 7 vs. Region 8?")).toBe("region 7 vs. region 8");
  });

  it("strips leading politeness prefixes, including stacked ones", () => {
    expect(normalizeQuestion("Please list the regions")).toBe("list the regions");
    expect(normalizeQuestion("please can you list the regions?")).toBe("list the regions");
  });

  it("applies NFKC so full-width variants collide with plain ASCII", () => {
    expect(normalizeQuestion("ｈｏｗ ｍａｎｙ ＢＨＷｓ？")).toBe("how many bhws");
  });

  it("keeps genuinely different questions distinct", () => {
    expect(normalizeQuestion("accreditation rate in Cebu")).not.toBe(normalizeQuestion("accreditation rate in Bohol"));
  });
});

describe("askCacheKey", () => {
  it("scopes by data version and geo, with 'national' for no geo context", () => {
    expect(askCacheKey("v1", "0722", "q")).toBe("v1|0722|q");
    expect(askCacheKey("v1", null, "q")).toBe("v1|national|q");
  });
});

describe("lookupAskCache", () => {
  it("returns the stored answer and bumps hit_count on a hit", async () => {
    state.row = { answer_md: "There are 5 BHWs.", provider: "gemini", status: "auto", hit_count: 3 };
    const hit = await lookupAskCache("q", null, "v1");
    expect(hit).toEqual({ answerMd: "There are 5 BHWs.", provider: "gemini" });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].hit_count).toBe(4);
  });

  it("misses on a blocked entry", async () => {
    state.row = { answer_md: "old answer", provider: "gemini", status: "blocked", hit_count: 0 };
    expect(await lookupAskCache("q", null, "v1")).toBeNull();
    expect(state.updates).toHaveLength(0);
  });

  it("misses on a read error", async () => {
    state.selectError = { message: "boom" };
    expect(await lookupAskCache("q", null, "v1")).toBeNull();
  });

  it("misses rather than throwing when the service client is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    expect(await lookupAskCache("q", null, "v1")).toBeNull();
  });
});

describe("storeAskAnswer", () => {
  const params = {
    questionNorm: "q",
    questionDisplay: "Q?",
    geoCode: null,
    dataVersion: "v1",
    answerMd: "Answer.",
    provider: "gemini",
  };

  it("upserts a new entry with status auto", async () => {
    await storeAskAnswer(params);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      cache_key: "v1|national|q",
      question_norm: "q",
      answer_md: "Answer.",
      status: "auto",
    });
  });

  it("overwrites an existing auto entry", async () => {
    state.row = { status: "auto" };
    await storeAskAnswer(params);
    expect(state.upserts).toHaveLength(1);
  });

  it("never clobbers an approved or blocked entry", async () => {
    state.row = { status: "approved" };
    await storeAskAnswer(params);
    state.row = { status: "blocked" };
    await storeAskAnswer(params);
    expect(state.upserts).toHaveLength(0);
  });

  it("does not throw when the service client is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    await expect(storeAskAnswer(params)).resolves.toBeUndefined();
  });
});
