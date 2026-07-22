import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, createSupabaseServiceClient } = vi.hoisted(() => {
  const state = {
    row: null as Record<string, unknown> | null,
    selectError: null as { message: string } | null,
    updates: [] as Record<string, unknown>[],
    upserts: [] as Record<string, unknown>[],
    rpcResult: { data: null as unknown, error: null as { message: string } | null },
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
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
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResult;
    },
  }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const {
  askCacheKey,
  lookupAskCache,
  lookupAskCacheNearMatch,
  isNearMatchEnabled,
  nearMatchThreshold,
  normalizeQuestion,
  storeAskAnswer,
} = await import("./ask-cache");

beforeEach(() => {
  state.row = null;
  state.selectError = null;
  state.updates = [];
  state.upserts = [];
  state.rpcResult = { data: null, error: null };
  state.rpcCalls = [];
  delete process.env.ASK_NEAR_MATCH_ENABLED;
  delete process.env.ASK_NEAR_MATCH_THRESHOLD;
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

describe("near-match config", () => {
  it("is disabled by default and enabled only by an explicit truthy flag", () => {
    expect(isNearMatchEnabled()).toBe(false);
    process.env.ASK_NEAR_MATCH_ENABLED = "1";
    expect(isNearMatchEnabled()).toBe(true);
    process.env.ASK_NEAR_MATCH_ENABLED = "true";
    expect(isNearMatchEnabled()).toBe(true);
    process.env.ASK_NEAR_MATCH_ENABLED = "yes";
    expect(isNearMatchEnabled()).toBe(false);
  });

  it("defaults the threshold to 0.85 and honors a valid override", () => {
    expect(nearMatchThreshold()).toBe(0.85);
    process.env.ASK_NEAR_MATCH_THRESHOLD = "0.9";
    expect(nearMatchThreshold()).toBe(0.9);
    process.env.ASK_NEAR_MATCH_THRESHOLD = "banana";
    expect(nearMatchThreshold()).toBe(0.85);
    process.env.ASK_NEAR_MATCH_THRESHOLD = "1.5";
    expect(nearMatchThreshold()).toBe(0.85);
  });
});

describe("lookupAskCacheNearMatch", () => {
  it("returns null without touching the db when disabled", async () => {
    const hit = await lookupAskCacheNearMatch("q", null, "v1");
    expect(hit).toBeNull();
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("returns the best approved match and bumps its hit_count when enabled", async () => {
    process.env.ASK_NEAR_MATCH_ENABLED = "1";
    state.rpcResult = {
      data: [
        { cache_key: "v1|national|how many bhws", question_norm: "how many bhws", answer_md: "There are 5.", provider: "gemini", score: 0.92 },
      ],
      error: null,
    };
    state.row = { hit_count: 2 }; // read for the bump

    const hit = await lookupAskCacheNearMatch("how many bhw", null, "v1");
    expect(hit).toMatchObject({ answerMd: "There are 5.", provider: "gemini", matchedNorm: "how many bhws", score: 0.92 });
    expect(state.rpcCalls[0]).toEqual({
      name: "match_ask_answer",
      args: { q: "how many bhw", scope: "national", version: "v1", min_sim: 0.85 },
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].hit_count).toBe(3);
  });

  it("passes the page geo scope through to the rpc", async () => {
    process.env.ASK_NEAR_MATCH_ENABLED = "1";
    state.rpcResult = { data: [], error: null };
    await lookupAskCacheNearMatch("q", "07", "v1");
    expect(state.rpcCalls[0].args).toMatchObject({ scope: "07" });
  });

  it("returns null on an empty match set or rpc error", async () => {
    process.env.ASK_NEAR_MATCH_ENABLED = "1";
    state.rpcResult = { data: [], error: null };
    expect(await lookupAskCacheNearMatch("q", null, "v1")).toBeNull();
    state.rpcResult = { data: null, error: { message: "boom" } };
    expect(await lookupAskCacheNearMatch("q", null, "v1")).toBeNull();
  });
});
