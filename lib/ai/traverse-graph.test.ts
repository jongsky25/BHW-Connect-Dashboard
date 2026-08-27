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
  LINEAGE_BOTH_MAX_DEPTH,
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
        as_of: null,
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

  /**
   * Increment 3.3. `both` exists because the crossing edges meet nose to nose at an issuance — a
   * dataset declares its basis and a programme declares the same one — so neither `out` nor `in`
   * alone gets from a table to the policy behind it.
   */
  it("plans an undirected walk when the chain changes direction", () => {
    expect(
      planTraversal({ source: "lineage", start: "dataset:uuc-phc-2025", direction: "both" }),
    ).toEqual({
      plan: {
        source: "lineage",
        fn: "traverse_kb",
        params: {
          start_key: "dataset:uuc-phc-2025",
          direction: "both",
          relations: null,
          max_depth: DEFAULT_DEPTH,
          row_cap: DEFAULT_TRAVERSAL_ROWS,
          as_of: null,
        },
      },
    });
  });

  it("holds an undirected walk to a lower depth than a directed one, and names which limit", () => {
    // Not the same cap: an undirected walk fans out faster, and §11 says to raise a depth cap
    // against real questions rather than guess upward.
    const refusal = errorOf({
      source: "lineage",
      start: "table:x",
      direction: "both",
      maxDepth: LINEAGE_BOTH_MAX_DEPTH + 1,
    });
    expect(refusal).toContain(`both lineage traversal limit of ${LINEAGE_BOTH_MAX_DEPTH}`);
    // The same depth is fine in a directed walk, so the refusal is about the mode, not the number.
    expect(
      planTraversal({
        source: "lineage",
        start: "table:x",
        direction: "out",
        maxDepth: LINEAGE_BOTH_MAX_DEPTH + 1,
      }),
    ).toHaveProperty("plan");
  });

  /**
   * Increment 3.4. `asOf` is what turns "is this still the rule" from a judgement the model makes
   * about dates into a filter the query applies. It belongs to the lineage graph alone: `dim_geo`
   * carries no validity (a geography's vintage lives in `dim_psgc_crosswalk`, which §13 defers),
   * so accepting the argument there and ignoring it would be an "as of" answer that was never
   * filtered — the exact failure the parameter exists to prevent.
   */
  it("passes asOf through to the traversal", () => {
    expect(
      planOf({ source: "lineage", start: "issuance:DM 2020-0490", asOf: "2022-06-01" }).params,
    ).toMatchObject({ as_of: "2022-06-01" });
  });

  it("refuses asOf on a geo walk rather than accepting an argument it would ignore", () => {
    expect(errorOf({ source: "geo", start: "07022", asOf: "2022-06-01" })).toContain(
      "no validity dates",
    );
  });

  it("accepts the relations extraction added, so a policy chain can be isolated", () => {
    const planned = planTraversal({
      source: "lineage",
      start: "dataset:uuc-phc-2025",
      direction: "both",
      relations: ["defined-by", "issued-by", "part-of"],
    });
    expect(planned).toHaveProperty("plan");
    expect(
      (planned as { plan: { params: { relations: string[] } } }).plan.params.relations,
    ).toEqual(["defined-by", "issued-by", "part-of"]);
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
          direction_path: ["out"],
        },
      ],
      error: null,
    };

    const result = await executeTraverseGraph({ source: "lineage", start: "table:agg_honorarium" });

    expect(result).toMatchObject({ source: "lineage", count: 1 });
    const [first] = (result as { results: { via: string; sources: string[] }[] }).results;
    expect(first.via).toBe(
      "table:agg_honorarium —derived-from→ table:fact_honorarium [ingestion/build_aggregates.sql]",
    );
    expect(first.sources).toEqual(["ingestion/build_aggregates.sql"]);
  });

  /**
   * Increment 3.3. A `both` walk mixes hops taken along an edge with hops taken against it, and
   * the chain has to say which was which: "—defined-by→ issuance:DC 2025-0549" (a dataset
   * declaring its basis) and "←defined-by— program:UUC for PHC" (a programme declaring the same
   * one) are opposite claims. Rendering them identically would give a reader a chain they cannot
   * check, which 1.6 treats as worse than no chain at all.
   */
  it("renders a backwards hop backwards, so a crossed chain stays readable", async () => {
    response = {
      data: [
        {
          key: "program:Unserved and Underserved Communities for Primary Health Care (UUC for PHC)",
          kind: "program",
          label: "UUC for PHC",
          depth: 2,
          path: [
            "dataset:uuc-phc-2025",
            "issuance:DC 2025-0549",
            "program:Unserved and Underserved Communities for Primary Health Care (UUC for PHC)",
          ],
          relation_path: ["defined-by", "defined-by"],
          source_path: [
            "supabase/migrations/20260826121100_seed_dim_dataset_uuc_phc.sql",
            "blhsd-2027-budget-cue-cards#p138",
          ],
          direction_path: ["out", "in"],
        },
      ],
      error: null,
    };

    const result = await executeTraverseGraph({
      source: "lineage",
      start: "dataset:uuc-phc-2025",
      direction: "both",
      maxDepth: 2,
    });

    const [first] = (result as { results: { via: string; directions: string[] }[] }).results;
    expect(first.directions).toEqual(["out", "in"]);
    expect(first.via).toBe(
      "dataset:uuc-phc-2025 " +
        "—defined-by→ issuance:DC 2025-0549 [supabase/migrations/20260826121100_seed_dim_dataset_uuc_phc.sql] ; " +
        "←defined-by— program:Unserved and Underserved Communities for Primary Health Care (UUC for PHC) " +
        "[blhsd-2027-budget-cue-cards#p138]",
    );
  });

  /**
   * Increment 3.4. A dated hop and an undated one are different claims, so the chain has to say
   * which it is: the supersession that put the 2025 list in force did so *from* a date, and an
   * answer that drops the date says "this is the rule" where the source says "this is the rule
   * since 2025".
   */
  it("renders a dated hop with its window and leaves a structural hop bare", async () => {
    response = {
      data: [
        {
          key: "issuance:DC 2025-0549",
          kind: "issuance",
          label: "DC 2025-0549",
          depth: 2,
          path: ["issuance:DM 2023-0409", "issuance:DM 2024-0459", "issuance:DC 2025-0549"],
          relation_path: ["supersedes", "supersedes"],
          source_path: ["blhsd-2027-budget-cue-cards#p140", "blhsd-2027-budget-cue-cards#p140"],
          direction_path: ["in", "in"],
          validity_path: ["2024-01-01..open", "2025-01-01..open"],
        },
      ],
      error: null,
    };

    const result = await executeTraverseGraph({
      source: "lineage",
      start: "issuance:DM 2023-0409",
      direction: "in",
      relations: ["supersedes"],
    });
    const [first] = (result as { results: { via: string; validity: string[] }[] }).results;
    expect(first.validity).toEqual(["2024-01-01..open", "2025-01-01..open"]);
    expect(first.via).toContain("←supersedes— issuance:DC 2025-0549 {2025-01-01..open}");
  });

  it("leaves an undated chain unadorned rather than inventing a window", async () => {
    // The LGU Health Scorecard chain: the deck calls each order "Revised" and gives no effective
    // date for any of them. The chain still orders correctly; `always` is not a date and must not
    // render as one.
    response = {
      data: [
        {
          key: "issuance:AO 2021-0002",
          kind: "issuance",
          label: "AO 2021-0002",
          depth: 1,
          path: ["issuance:AO 2019-0027", "issuance:AO 2021-0002"],
          relation_path: ["supersedes"],
          source_path: ["blhsd-2027-budget-cue-cards#p167"],
          direction_path: ["in"],
          validity_path: ["always"],
        },
      ],
      error: null,
    };
    const result = await executeTraverseGraph({
      source: "lineage",
      start: "issuance:AO 2019-0027",
      direction: "in",
    });
    const [first] = (result as { results: { via: string }[] }).results;
    expect(first.via).not.toContain("{");
    expect(first.via).toContain(
      "←supersedes— issuance:AO 2021-0002 [blhsd-2027-budget-cue-cards#p167]",
    );
  });

  it("falls back to a forward arrow when the database returned no directions", async () => {
    // Defensive rather than hypothetical: the column is new in 3.3 and a stale cached plan or an
    // older function would omit it. A missing direction must not render as a broken chain.
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
    const [first] = (result as { results: { via: string; directions: string[] }[] }).results;
    expect(first.directions).toEqual([]);
    expect(first.via).toContain("—derived-from→");
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

  it("refuses an asOf that is not a date, before any database call", async () => {
    // The schema is where this is caught, not planTraversal — "June 2022" would otherwise reach
    // Postgres as a date literal and either error there or parse into something nobody asked for.
    const result = await executeTraverseGraph({
      source: "lineage",
      start: "issuance:DM 2020-0490",
      asOf: "June 2022",
    });
    expect(result).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown source before any database call", async () => {
    const result = await executeTraverseGraph({ source: "psgc", start: "PH" });
    expect(result).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });
});
