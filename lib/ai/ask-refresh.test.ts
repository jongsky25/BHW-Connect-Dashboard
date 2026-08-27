import { beforeEach, describe, expect, it, vi } from "vitest";

type StaleRow = {
  cache_key: string;
  question_display: string;
  question_norm: string;
  geo_code: string | null;
};

const { state, runToolLoop, getDatasetBySlug, getGeoByCode } = vi.hoisted(() => {
  const state = {
    /** Stale approved rows the fake returns per `dataset_slug` filter — the refresh walks one
     * dataset scope at a time now, so the fake has to answer per scope rather than once. */
    rowsBySlug: {} as Record<string, StaleRow[]>,
    error: null as { message: string } | null,
    upserts: [] as Record<string, unknown>[],
    deletes: [] as string[],
  };
  const runToolLoop = vi.fn();
  const getDatasetBySlug = vi.fn(async (slug: string) => ({
    lastUpdatedAt: slug === "uuc-phc-2025" ? "u2" : "v2",
  }));
  const getGeoByCode = vi.fn(async () => ({ geoCode: "07", geoLevel: "region", geoName: "Central Visayas" }));
  return { state, runToolLoop, getDatasetBySlug, getGeoByCode };
});

vi.mock("./agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/db/dataset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/dataset")>()),
  getDatasetBySlug,
}));
vi.mock("@/lib/db/geo", () => ({ getGeoByCode }));
vi.mock("@/lib/db/service-client", () => {
  const makeBuilder = () => {
    let slug = "";
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.neq = () => builder;
    builder.limit = () => builder;
    builder.eq = (col: string, value: string) => {
      if (col === "dataset_slug") slug = value;
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: state.error ? null : (state.rowsBySlug[slug] ?? []), error: state.error });
    builder.upsert = async (values: Record<string, unknown>) => {
      state.upserts.push(values);
      return { error: null };
    };
    builder.delete = () => ({
      eq: async (_col: string, key: string) => {
        state.deletes.push(key);
        return { error: null };
      },
    });
    return builder;
  };
  return { createSupabaseServiceClient: () => ({ from: () => makeBuilder() }) };
});

const { refreshApprovedAskAnswers } = await import("./ask-refresh");

const opts = { startedAt: Date.now(), deadlineMs: 1_000_000 };
const groundedLoop = { allCapped: false, finalText: "There are 5 BHWs.", toolPayloads: [{ n: 5 }], provider: "gemini" };

beforeEach(() => {
  state.rowsBySlug = {};
  state.error = null;
  state.upserts = [];
  state.deletes = [];
  runToolLoop.mockReset();
  getGeoByCode.mockClear();
  getDatasetBySlug.mockClear();
});

describe("refreshApprovedAskAnswers", () => {
  it("does nothing when there are no stale approved entries", async () => {
    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toEqual({ staleTotal: 0, attempted: 0, refreshed: 0, ranOutOfTime: false });
    expect(runToolLoop).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(0);
  });

  it("regenerates a stale entry under the new version and drops the old row", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|national|how many bhws", question_display: "How many BHWs?", question_norm: "how many bhws", geo_code: null },
    ];
    runToolLoop.mockResolvedValue(groundedLoop);

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ staleTotal: 1, attempted: 1, refreshed: 1, ranOutOfTime: false });
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      cache_key: "v2|bhw-2025|national|how many bhws",
      data_version: "v2",
      dataset_slug: "bhw-2025",
      status: "approved",
      answer_md: "There are 5 BHWs.",
    });
    // superseded old-version row removed
    expect(state.deletes).toEqual(["v1|bhw-2025|national|how many bhws"]);
    // national scope: no page-context lookup
    expect(getGeoByCode).not.toHaveBeenCalled();
  });

  /**
   * §8 defect 3 in the refresh path. A UUC row regenerated under the BHW prompt and the BHW tools
   * would be a wrong-dataset answer written back at `status = 'approved'` — worse than the cache
   * collision, because an approved row is the one the near-match path is allowed to reuse. The
   * assertions are on the prompt, the version and the key, which is the whole triple that has to
   * come from the same scope.
   */
  it("regenerates each dataset under its own prompt, its own tools and its own version", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|national|how many are there", question_display: "How many are there?", question_norm: "how many are there", geo_code: null },
    ];
    state.rowsBySlug["uuc-phc-2025"] = [
      { cache_key: "u1|uuc-phc-2025|national|how many are there", question_display: "How many are there?", question_norm: "how many are there", geo_code: null },
    ];
    runToolLoop.mockResolvedValue(groundedLoop);

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ staleTotal: 2, attempted: 2, refreshed: 2 });

    const prompts = runToolLoop.mock.calls.map((c) => c[0][0].content as string);
    expect(prompts.some((p) => p.startsWith("You are the BHW Connect data assistant"))).toBe(true);
    expect(prompts.some((p) => p.startsWith("You are the UUC for PHC data assistant"))).toBe(true);

    // Each scope brings its own tool set into the loop, not the default.
    const toolNames = runToolLoop.mock.calls.map(
      (c) => (c[2] as { definition: { name: string } }[]).map((t) => t.definition.name).sort().join(","),
    );
    expect(new Set(toolNames).size).toBe(2);

    expect(state.upserts.map((u) => u.cache_key).sort()).toEqual([
      "u2|uuc-phc-2025|national|how many are there",
      "v2|bhw-2025|national|how many are there",
    ]);
    expect(state.upserts.map((u) => u.dataset_slug).sort()).toEqual(["bhw-2025", "uuc-phc-2025"]);
  });

  it("reconstructs page context for a geo-scoped entry", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|07|accreditation rate", question_display: "accreditation rate", question_norm: "accreditation rate", geo_code: "07" },
    ];
    runToolLoop.mockResolvedValue(groundedLoop);

    await refreshApprovedAskAnswers(opts);
    expect(getGeoByCode).toHaveBeenCalledWith("07");
    const systemMsg = runToolLoop.mock.calls[0][0][0].content as string;
    expect(systemMsg).toContain("geo_code 07 (level region)");
  });

  it("skips (keeps the dormant old row) when every provider is capped", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|national|q", question_display: "q", question_norm: "q", geo_code: null },
    ];
    runToolLoop.mockResolvedValue({ allCapped: true, finalText: null, toolPayloads: [], provider: null });

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 1, refreshed: 0 });
    expect(state.upserts).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("does not store an answer that the numeric audit strips to empty", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|national|q", question_display: "q", question_norm: "q", geo_code: null },
    ];
    // 999 is not present in the tool payloads, so the only sentence is stripped.
    runToolLoop.mockResolvedValue({ allCapped: false, finalText: "There are 999 BHWs.", toolPayloads: [{ n: 5 }], provider: "gemini" });

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 1, refreshed: 0 });
    expect(state.upserts).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("stops at the deadline and reports ranOutOfTime", async () => {
    state.rowsBySlug["bhw-2025"] = [
      { cache_key: "v1|bhw-2025|national|a", question_display: "a", question_norm: "a", geo_code: null },
      { cache_key: "v1|bhw-2025|national|b", question_display: "b", question_norm: "b", geo_code: null },
    ];
    runToolLoop.mockResolvedValue(groundedLoop);
    // deadline already passed (startedAt far in the past, deadline 0) → first iteration bails.
    const result = await refreshApprovedAskAnswers({ startedAt: -1_000_000, deadlineMs: 0 });
    expect(result).toMatchObject({ staleTotal: 2, attempted: 0, refreshed: 0, ranOutOfTime: true });
  });

  it("returns an empty result on a read error", async () => {
    state.error = { message: "boom" };
    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 0, refreshed: 0 });
  });
});
