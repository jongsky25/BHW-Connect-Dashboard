import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredColumn, RegisteredDataset } from "@/lib/db/dataset-registry";

const { getRegisteredDataset } = vi.hoisted(() => ({ getRegisteredDataset: vi.fn() }));
vi.mock("@/lib/db/dataset-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/dataset-registry")>()),
  getRegisteredDataset,
}));

/**
 * A recording stand-in for the supabase query builder: every call is appended to `calls`, and the
 * awaited result is whatever `response` holds. The point of these tests is the exact PostgREST
 * call the tool issues — a filter silently dropped or a limit never applied is the failure mode
 * that a payload-shape assertion alone would not catch.
 */
const calls: unknown[][] = [];
let response: { data: unknown; error: { message: string } | null; count: number | null } = {
  data: [],
  error: null,
  count: null,
};

vi.mock("@/lib/db/service-client", () => {
  const builder = new Proxy(
    {},
    {
      get(_target, method: string) {
        if (method === "then") return undefined;
        return (...args: unknown[]) => {
          calls.push([method, ...args.filter((a) => !(a instanceof AbortSignal))]);
          return method === "abortSignal" ? Promise.resolve(response) : builder;
        };
      },
    },
  ) as Record<string, (...args: unknown[]) => unknown>;

  return {
    createSupabaseServiceClient: () => ({
      from: (table: string) => {
        calls.push(["from", table]);
        return builder;
      },
    }),
  };
});

const { DEFAULT_ROWS, MAX_ROWS, executeQueryDataset, planQuery } = await import("./query-dataset");

function col(overrides: Partial<RegisteredColumn> & { name: string }): RegisteredColumn {
  return {
    dataType: "text",
    allowedValues: null,
    meaning: "…",
    unit: null,
    role: "dimension",
    isJoinKey: false,
    joinsTo: null,
    isQueryable: true,
    ...overrides,
  };
}

/** Shaped after the real agg_demographics registry row. */
const demographics: RegisteredDataset = {
  tableName: "agg_demographics",
  title: "BHW demographics by geography",
  summary: "Counts and shares of profiled BHWs by demographic dimension.",
  grain: "One geography x dimension x category per dataset.",
  datasetSlug: "bhw-2025",
  exposure: "public",
  rowEstimate: 530465,
  notesMd: "Where is_suppressed is true, n and pct are withheld.",
  docPath: null,
  columns: [
    col({ name: "id", dataType: "bigint", role: "meta", isQueryable: false }),
    col({
      name: "dataset_id",
      dataType: "bigint",
      role: "key",
      isJoinKey: true,
      joinsTo: "dim_dataset.dataset_id",
    }),
    col({ name: "geo_code", role: "key", isJoinKey: true, joinsTo: "dim_geo.geo_code" }),
    col({
      name: "geo_level",
      dataType: "geo_level_enum",
      allowedValues: ["national", "region", "province", "citymun", "barangay"],
    }),
    col({ name: "category" }),
    col({ name: "n", dataType: "integer", role: "measure", unit: "count" }),
    col({ name: "pct", dataType: "numeric", role: "measure", unit: "percent (0-100)" }),
    col({ name: "is_suppressed", dataType: "boolean" }),
  ],
};

/**
 * Shaped after the real agg_uuc_phc_counts registry row (plan U5). Present here because U5's
 * Verify is a claim about this tool: the UUC dataset became reachable by registration alone, with
 * no new tool code, and a column outside the dictionary is still refused.
 */
const uucCounts: RegisteredDataset = {
  tableName: "agg_uuc_phc_counts",
  title: "UUC for PHC listed-barangay counts by geography",
  summary:
    "How many barangays in an area are on the 2025 UUC for PHC list, against how many the area contains in total.",
  grain: "One geography per dataset.",
  datasetSlug: "uuc-phc-2025",
  exposure: "public",
  rowEstimate: 1788,
  notesMd:
    "n_barangays is the dim_geo universe, not the source workbook assessed set. Rows exist for every geography including those with none listed: a 0 is a finding, not missing data.",
  docPath: "docs/UUC_PHC_2025_PLAN.md",
  columns: [
    col({ name: "id", dataType: "bigint", role: "meta", isQueryable: false }),
    col({
      name: "dataset_id",
      dataType: "bigint",
      role: "key",
      isJoinKey: true,
      joinsTo: "dim_dataset.dataset_id",
    }),
    col({ name: "geo_code", role: "key", isJoinKey: true, joinsTo: "dim_geo.geo_code" }),
    col({
      name: "geo_level",
      dataType: "geo_level_enum",
      allowedValues: ["national", "region", "province", "citymun"],
    }),
    col({ name: "n_listed", dataType: "integer", role: "measure", unit: "count" }),
    col({ name: "n_barangays", dataType: "integer", role: "measure", unit: "count" }),
  ],
};

/** A table with no dataset_id — the multi-dataset warning must not fire on it. */
const geoDim: RegisteredDataset = {
  ...demographics,
  tableName: "dim_geo",
  notesMd: null,
  columns: [col({ name: "geo_code", role: "key" }), col({ name: "geo_name" })],
};

function planOf(dataset: RegisteredDataset, args: Parameters<typeof planQuery>[1]) {
  const result = planQuery(dataset, args);
  if ("error" in result) throw new Error(`expected a plan, got refusal: ${result.error}`);
  return result.plan;
}

function errorOf(dataset: RegisteredDataset, args: Parameters<typeof planQuery>[1]) {
  const result = planQuery(dataset, args);
  if (!("error" in result)) throw new Error("expected a refusal, got a plan");
  return result.error;
}

describe("planQuery — allowlisting", () => {
  it("projects every queryable column when none are named, and never a non-queryable one", () => {
    const plan = planOf(demographics, { table: "agg_demographics" });
    expect(plan.columns).toEqual([
      "dataset_id",
      "geo_code",
      "geo_level",
      "category",
      "n",
      "pct",
      "is_suppressed",
    ]);
    expect(plan.columns).not.toContain("id");
  });

  it("refuses a column the dictionary does not list, and names the ones that are", () => {
    const error = errorOf(demographics, { table: "agg_demographics", columns: ["n", "bhw_name"] });
    expect(error).toContain("bhw_name is not available");
    expect(error).toContain("geo_code");
  });

  it("refuses a non-queryable column even though it exists on the table", () => {
    expect(errorOf(demographics, { table: "agg_demographics", columns: ["id"] })).toContain(
      "id is not available",
    );
  });

  it("refuses filtering or ordering on a column outside the dictionary", () => {
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "salary", op: "gt", value: 1 }],
      }),
    ).toContain("salary is not available");
    expect(errorOf(demographics, { table: "agg_demographics", orderBy: "id" })).toContain(
      "id is not available",
    );
  });

  it("de-duplicates a column the model asks for twice", () => {
    expect(
      planOf(demographics, { table: "agg_demographics", columns: ["n", "n"] }).columns,
    ).toEqual(["n"]);
  });
});

describe("planQuery — filter vocabulary", () => {
  it("refuses a value outside a column's closed vocabulary, quoting the real values", () => {
    const error = errorOf(demographics, {
      table: "agg_demographics",
      filters: [{ column: "geo_level", op: "eq", value: "municipality" }],
    });
    expect(error).toContain("only takes: national, region, province, citymun, barangay");
  });

  it("refuses text where the column is numeric", () => {
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "n", op: "gt", value: "50%" }],
      }),
    ).toContain("filter it with a number");
  });

  it("refuses a non-boolean on a boolean column", () => {
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "is_suppressed", op: "eq", value: "false" }],
      }),
    ).toContain("filter it with true or false");
  });

  it("requires a value for a scalar operator and a list for in", () => {
    expect(
      errorOf(demographics, { table: "agg_demographics", filters: [{ column: "n", op: "gt" }] }),
    ).toContain("needs a value");
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "geo_code", op: "in", value: "PH" }],
      }),
    ).toContain("needs a list of values");
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "geo_code", op: "eq", value: ["PH"] }],
      }),
    ).toContain("takes a single value");
  });

  it("takes is_null / not_null with no value at all", () => {
    const plan = planOf(demographics, {
      table: "agg_demographics",
      filters: [{ column: "n", op: "is_null" }],
    });
    expect(plan.filters).toEqual([{ column: "n", op: "is_null" }]);
  });

  it("validates every member of an in list against the vocabulary", () => {
    expect(
      errorOf(demographics, {
        table: "agg_demographics",
        filters: [{ column: "geo_level", op: "in", value: ["region", "municipality"] }],
      }),
    ).toContain("only takes");
  });
});

describe("planQuery — limits and warnings", () => {
  it("defaults the row limit and sort direction", () => {
    const plan = planOf(demographics, { table: "agg_demographics" });
    expect(plan.limit).toBe(DEFAULT_ROWS);
    expect(plan.direction).toBe("desc");
    expect(plan.mode).toBe("rows");
  });

  it("warns that an unscoped query may span datasets, and carries the table's caveat", () => {
    const plan = planOf(demographics, { table: "agg_demographics" });
    expect(plan.warnings[0]).toContain("No dataset_id filter");
    expect(plan.warnings).toContain("Where is_suppressed is true, n and pct are withheld.");
  });

  it("drops the dataset warning once the query is scoped", () => {
    const plan = planOf(demographics, {
      table: "agg_demographics",
      filters: [{ column: "dataset_id", op: "eq", value: 1 }],
    });
    expect(plan.warnings.some((w) => w.includes("No dataset_id filter"))).toBe(false);
  });

  it("does not invent a dataset warning for a table that has no dataset_id", () => {
    expect(planOf(geoDim, { table: "dim_geo" }).warnings).toEqual([]);
  });
});

describe("executeQueryDataset", () => {
  beforeEach(() => getRegisteredDataset.mockReset());

  it("refuses an unregistered table and points at the catalogue", async () => {
    getRegisteredDataset.mockResolvedValue(null);
    const result = await executeQueryDataset({ table: "fact_bhw_raw" }, "public");
    expect(result).toEqual({
      error: expect.stringContaining("fact_bhw_raw is not registered for public use"),
    });
    expect(getRegisteredDataset).toHaveBeenCalledWith("fact_bhw_raw", "public");
  });

  it("refuses a row limit past the cap before any query is issued", async () => {
    const result = await executeQueryDataset(
      { table: "agg_demographics", limit: MAX_ROWS + 1 },
      "internal",
    );
    expect(result).toHaveProperty("error");
    expect(getRegisteredDataset).not.toHaveBeenCalled();
  });

  it("refuses an operator outside the supported set", async () => {
    const result = await executeQueryDataset(
      { table: "agg_demographics", filters: [{ column: "n", op: "regex", value: ".*" }] },
      "internal",
    );
    expect(result).toHaveProperty("error");
    expect(getRegisteredDataset).not.toHaveBeenCalled();
  });
});

describe("executeQueryDataset — the PostgREST call it actually issues", () => {
  beforeEach(() => {
    getRegisteredDataset.mockReset();
    calls.length = 0;
    response = { data: [], error: null, count: null };
  });

  it("projects, filters, orders and caps a rows query, and reports units and caveats", async () => {
    getRegisteredDataset.mockResolvedValue(demographics);
    response = {
      data: [
        { geo_code: "0722200", geo_level: "barangay", category: "Female", n: 12, pct: 92.3 },
        { geo_code: "0722200", geo_level: "barangay", category: "Male", n: 1, pct: 7.7 },
      ],
      error: null,
      count: null,
    };

    const result = await executeQueryDataset(
      {
        table: "agg_demographics",
        columns: ["geo_code", "geo_level", "category", "n", "pct"],
        filters: [
          { column: "dataset_id", op: "eq", value: 1 },
          { column: "geo_level", op: "eq", value: "barangay" },
          { column: "is_suppressed", op: "eq", value: false },
        ],
        orderBy: "n",
        direction: "desc",
        limit: 2,
      },
      "public",
    );

    expect(calls).toEqual([
      ["from", "agg_demographics"],
      ["select", "geo_code, geo_level, category, n, pct"],
      ["eq", "dataset_id", 1],
      ["eq", "geo_level", "barangay"],
      ["eq", "is_suppressed", false],
      ["order", "n", { ascending: false, nullsFirst: false }],
      ["limit", 2],
      ["abortSignal"],
    ]);

    expect(result).toMatchObject({
      table: "agg_demographics",
      mode: "rows",
      grain: "One geography x dimension x category per dataset.",
      units: { n: "count", pct: "percent (0-100)" },
      // Two rows against a limit of 2: there may be more matches than were returned, and the
      // model has to know that before it says "only two".
      truncated: true,
    });
    expect((result as { warnings: string[] }).warnings).toContain(
      "Where is_suppressed is true, n and pct are withheld.",
    );
  });

  it("asks PostgREST for a head-only count in count mode, with no ordering or limit", async () => {
    getRegisteredDataset.mockResolvedValue(demographics);
    response = { data: null, error: null, count: 4821 };

    const result = await executeQueryDataset(
      {
        table: "agg_demographics",
        mode: "count",
        filters: [{ column: "geo_level", op: "eq", value: "province" }],
      },
      "public",
    );

    expect(calls[1]).toEqual(["select", expect.any(String), { count: "exact", head: true }]);
    expect(calls.some(([method]) => method === "order" || method === "limit")).toBe(false);
    expect(result).toMatchObject({ mode: "count", matchingRows: 4821 });
  });

  it("surfaces a database error as data the model can react to, never a throw", async () => {
    getRegisteredDataset.mockResolvedValue(demographics);
    response = {
      data: null,
      error: { message: "canceling statement due to statement timeout" },
      count: null,
    };

    const result = await executeQueryDataset({ table: "agg_demographics" }, "public");
    expect(result).toEqual({ error: expect.stringContaining("statement timeout") });
  });
});


describe("planQuery — the UUC for PHC registration (plan U5)", () => {
  it("plans a query over agg_uuc_phc_counts with no tool code of its own", () => {
    const plan = planOf(uucCounts, {
      table: "agg_uuc_phc_counts",
      filters: [
        { column: "geo_level", op: "eq", value: "region" },
        { column: "dataset_id", op: "eq", value: 9 },
      ],
      orderBy: "n_listed",
      limit: 5,
    });
    expect(plan.columns).toEqual(["dataset_id", "geo_code", "geo_level", "n_listed", "n_barangays"]);
    expect(plan.orderBy).toBe("n_listed");
    // The caveat travels with the payload; nothing about it is the caller's to remember.
    expect(plan.warnings.join(" ")).toMatch(/not the source workbook assessed set/);
  });

  it("refuses a column the dictionary does not carry, even a plausible one", () => {
    // "pct_listed" is the obvious guess, and it does not exist: the share is derived in the read
    // layer so that it has one definition. A tool that let the model select it would be inventing
    // a column name that PostgREST would then 400 on, opaquely.
    expect(errorOf(uucCounts, { table: "agg_uuc_phc_counts", columns: ["pct_listed"] })).toMatch(
      /pct_listed is not available on agg_uuc_phc_counts/,
    );
  });

  it("refuses barangay as a geo_level, quoting the levels this aggregate actually has", () => {
    const error = errorOf(uucCounts, {
      table: "agg_uuc_phc_counts",
      filters: [{ column: "geo_level", op: "eq", value: "barangay" }],
    });
    expect(error).toMatch(/only takes: national, region, province, citymun/);
  });
});
