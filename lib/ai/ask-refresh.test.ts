import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, runToolLoop, getActiveDataset, getGeoByCode } = vi.hoisted(() => {
  const state = {
    selectResult: { data: null as unknown, error: null as { message: string } | null },
    upserts: [] as Record<string, unknown>[],
    deletes: [] as string[],
  };
  const runToolLoop = vi.fn();
  const getActiveDataset = vi.fn(async () => ({ lastUpdatedAt: "v2" }));
  const getGeoByCode = vi.fn(async () => ({ geoCode: "07", geoLevel: "region", geoName: "Central Visayas" }));
  return { state, runToolLoop, getActiveDataset, getGeoByCode };
});

vi.mock("./agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/db/dataset", () => ({ getActiveDataset }));
vi.mock("@/lib/db/geo", () => ({ getGeoByCode }));
vi.mock("@/lib/db/service-client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.selectResult);
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
  return { createSupabaseServiceClient: () => ({ from: () => builder }) };
});

const { refreshApprovedAskAnswers } = await import("./ask-refresh");

const opts = { startedAt: Date.now(), deadlineMs: 1_000_000 };
const groundedLoop = { allCapped: false, finalText: "There are 5 BHWs.", toolPayloads: [{ n: 5 }], provider: "gemini" };

beforeEach(() => {
  state.selectResult = { data: null, error: null };
  state.upserts = [];
  state.deletes = [];
  runToolLoop.mockReset();
  getGeoByCode.mockClear();
});

describe("refreshApprovedAskAnswers", () => {
  it("does nothing when there are no stale approved entries", async () => {
    state.selectResult = { data: [], error: null };
    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toEqual({ staleTotal: 0, attempted: 0, refreshed: 0, ranOutOfTime: false });
    expect(runToolLoop).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(0);
  });

  it("regenerates a stale entry under the new version and drops the old row", async () => {
    state.selectResult = {
      data: [{ cache_key: "v1|national|how many bhws", question_display: "How many BHWs?", question_norm: "how many bhws", geo_code: null }],
      error: null,
    };
    runToolLoop.mockResolvedValue(groundedLoop);

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ staleTotal: 1, attempted: 1, refreshed: 1, ranOutOfTime: false });
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      cache_key: "v2|national|how many bhws",
      data_version: "v2",
      status: "approved",
      answer_md: "There are 5 BHWs.",
    });
    // superseded old-version row removed
    expect(state.deletes).toEqual(["v1|national|how many bhws"]);
    // national scope: no page-context lookup
    expect(getGeoByCode).not.toHaveBeenCalled();
  });

  it("reconstructs page context for a geo-scoped entry", async () => {
    state.selectResult = {
      data: [{ cache_key: "v1|07|accreditation rate", question_display: "accreditation rate", question_norm: "accreditation rate", geo_code: "07" }],
      error: null,
    };
    runToolLoop.mockResolvedValue(groundedLoop);

    await refreshApprovedAskAnswers(opts);
    expect(getGeoByCode).toHaveBeenCalledWith("07");
    const systemMsg = runToolLoop.mock.calls[0][0][0].content as string;
    expect(systemMsg).toContain("geo_code 07 (level region)");
  });

  it("skips (keeps the dormant old row) when every provider is capped", async () => {
    state.selectResult = {
      data: [{ cache_key: "v1|national|q", question_display: "q", question_norm: "q", geo_code: null }],
      error: null,
    };
    runToolLoop.mockResolvedValue({ allCapped: true, finalText: null, toolPayloads: [], provider: null });

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 1, refreshed: 0 });
    expect(state.upserts).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("does not store an answer that the numeric audit strips to empty", async () => {
    state.selectResult = {
      data: [{ cache_key: "v1|national|q", question_display: "q", question_norm: "q", geo_code: null }],
      error: null,
    };
    // 999 is not present in the tool payloads, so the only sentence is stripped.
    runToolLoop.mockResolvedValue({ allCapped: false, finalText: "There are 999 BHWs.", toolPayloads: [{ n: 5 }], provider: "gemini" });

    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 1, refreshed: 0 });
    expect(state.upserts).toHaveLength(0);
    expect(state.deletes).toHaveLength(0);
  });

  it("stops at the deadline and reports ranOutOfTime", async () => {
    state.selectResult = {
      data: [
        { cache_key: "v1|national|a", question_display: "a", question_norm: "a", geo_code: null },
        { cache_key: "v1|national|b", question_display: "b", question_norm: "b", geo_code: null },
      ],
      error: null,
    };
    runToolLoop.mockResolvedValue(groundedLoop);
    // deadline already passed (startedAt far in the past, deadline 0) → first iteration bails.
    const result = await refreshApprovedAskAnswers({ startedAt: -1_000_000, deadlineMs: 0 });
    expect(result).toMatchObject({ staleTotal: 2, attempted: 0, refreshed: 0, ranOutOfTime: true });
  });

  it("returns an empty result on a read error", async () => {
    state.selectResult = { data: null, error: { message: "boom" } };
    const result = await refreshApprovedAskAnswers(opts);
    expect(result).toMatchObject({ attempted: 0, refreshed: 0 });
  });
});
