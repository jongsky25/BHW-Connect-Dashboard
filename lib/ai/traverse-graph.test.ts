import { beforeEach, describe, expect, it, vi } from "vitest";

/** Records the rpc(name, params) call the tool issues, and returns `response` when awaited. */
const calls: { fn: string; params: Record<string, unknown> }[] = [];
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock("@/lib/db/service-client", () => ({
  createSupabaseServiceClient: () => ({
    rpc: (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { abortSignal: () => Promise.resolve(response) };
    },
  }),
}));

const {
  GEO_MAX_DEPTH,
  LINEAGE_MAX_DEPTH,
  DEFAULT_DEPTH,
  DEFAULT_TRAVERSAL_ROWS,
  executeTraverseGraph,
  planTraversal,
} = await import("./traverse-graph");

function planOf(args: Parameters<typeof planTraversal>[0]) {
  const result = planTraversal(args);
  if ("error" in result) throw new Error(`expected a plan, got refusal: ${result.error}`);
  return result.plan;
}

function errorOf(args: Parameters<typeof planTraversal>[0]) {
  const result = planTraversal(args);
  if (!("error" in result)) throw new Error("expected a refusal, got a plan");
  return result.error;
}

describe("planTraversal — geo", () => {
  it("defaults to walking down, at the default depth and row cap", () => {
    expect(planOf({ source: "geo", start: "07022" })).toEqual({
      source: "geo",
      fn: "traverse_geo",
      params: {
        start_code: "07022",
        direction: "down",
        max_depth: DEFAULT_DEPTH,
        row_cap: DEFAULT_TRAVERSAL_ROWS,
      },
    });
  });

  it("walks up for an ancestor question", () => {
    expect(
      planOf({ source: "geo", start: "0102801001", direction: "up", maxDepth: 4 }).params,
    ).toMatchObject({
      direction: "up",
      max_depth: 4,
    });
  });

  it("refuses a depth past the geo limit, and says what the limit is", () => {
    const error = errorOf({ source: "geo", start: "PH", maxDepth: GEO_MAX_DEPTH + 1 });
    expect(error).toContain(`limit of ${GEO_MAX_DEPTH}`);
  });

  it("refuses a lineage direction on a geo walk", () => {
    expect(errorOf({ source: "geo", start: "PH", direction: "out" })).toContain(
      "down (into a place) or up",
    );
  });

  it("refuses relations on a geo walk — containment has only one relation", () => {
    expect(errorOf({ source: "geo", start: "PH", relations: ["derived-from"] })).toContain(
      "lineage graph only",
    );
  });
});

describe("planTraversal — lineage", () => {
  it("defaults to walking out from a node key", () => {
    expect(planOf({ source: "lineage", start: "table:agg_honorarium" })).toEqual({
      source: "lineage",
      fn: "traverse_kb",
      params: {
        start_key: "table:agg_honorarium",
        direction: "out",
        relations: null,
        max_depth: DEFAULT_DEPTH,
        row_cap: DEFAULT_TRAVERSAL_ROWS,
      },
    });
  });

  it("passes a relation filter through, and null when none is given", () => {
    expect(
      planOf({ source: "lineage", start: "table:agg_poverty", relations: ["built-by"] }).params,
    ).toMatchObject({
      relations: ["built-by"],
    });
  });

  it("refuses a bare table name — a lineage walk starts at a node key", () => {
    expect(errorOf({ source: "lineage", start: "agg_honorarium" })).toContain(
      "table:agg_honorarium",
    );
  });

  it("refuses a depth past the lineage limit", () => {
    expect(
      errorOf({ source: "lineage", start: "table:x", maxDepth: LINEAGE_MAX_DEPTH + 1 }),
    ).toContain(`limit of ${LINEAGE_MAX_DEPTH}`);
  });

  it("refuses a geo direction on a lineage walk", () => {
    expect(errorOf({ source: "lineage", start: "table:x", direction: "down" })).toContain(
      "out (what this was built",
    );
  });
});

describe("executeTraverseGraph", () => {
  beforeEach(() => {
    calls.length = 0;
    response = { data: [], error: null };
  });

  it("calls traverse_geo with the planned parameters and returns each result with its path", async () => {
    response = {
      data: [
        {
          geo_code: "0702225",
          geo_level: "citymun",
          geo_name: "GINATILAN",
          depth: 1,
          path: ["07022", "0702225"],
        },
      ],
      error: null,
    };

    const result = await executeTraverseGraph({ source: "geo", start: "07022", limit: 50 });

    expect(calls).toEqual([
      {
        fn: "traverse_geo",
        params: { start_code: "07022", direction: "down", max_depth: DEFAULT_DEPTH, row_cap: 50 },
      },
    ]);
    expect(result).toMatchObject({
      source: "geo",
      count: 1,
      truncated: false,
      results: [{ geoCode: "0702225", geoName: "GINATILAN", depth: 1, path: ["07022", "0702225"] }],
    });
  });

  it("renders a lineage chain with the file behind every step", async () => {
    response = {
      data: [
        {
          key: "table:fact_honorarium",
          kind: "table",
          label: "fact_honorarium",
          depth: 1,
          path: ["table:agg_honorarium", "table:fact_honorarium"],
          relation_path: ["derived-from"],
          source_path: ["ingestion/build_aggregates.sql"],
        },
      ],
      error: null,
    };

    const result = await executeTraverseGraph({ source: "lineage", start: "table:agg_honorarium" });

    expect(result).toMatchObject({ source: "lineage", count: 1 });
    const [first] = (result as { results: { via: string; sources: string[] }[] }).results;
    expect(first.via).toBe(
      "table:agg_honorarium derived-from → table:fact_honorarium [ingestion/build_aggregates.sql]",
    );
    expect(first.sources).toEqual(["ingestion/build_aggregates.sql"]);
  });

  it("flags truncation when the row cap was reached", async () => {
    response = {
      data: [{ geo_code: "a", geo_level: "citymun", geo_name: "A", depth: 1, path: ["x", "a"] }],
      error: null,
    };
    const result = await executeTraverseGraph({ source: "geo", start: "x", limit: 1 });
    expect(result).toMatchObject({ truncated: true });
  });

  it("returns the database's own refusal as data, not as a throw", async () => {
    response = {
      data: null,
      error: { message: "traverse_geo max_depth 9 exceeds the limit of 5" },
    };
    const result = await executeTraverseGraph({ source: "geo", start: "PH", maxDepth: 5 });
    expect(result).toEqual({ error: expect.stringContaining("exceeds the limit of 5") });
  });

  it("refuses an unknown source before any database call", async () => {
    const result = await executeTraverseGraph({ source: "psgc", start: "PH" });
    expect(result).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });
});
