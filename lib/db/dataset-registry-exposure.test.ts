import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./database.types";

type RegistryRow = Database["public"]["Tables"]["dataset_registry"]["Row"];
type ColumnRow = Database["public"]["Tables"]["dataset_column"]["Row"];

/**
 * `exposure`'s filtering (docs/DECISIONS.md — the "0 registered datasets" investigation).
 *
 * `public` is the real security boundary and stays an exact match. `internal` is a superset: the
 * internal assistant needs everything the public layer already exposes *plus* the internal-only
 * (`fact_*`/raw) rows, so filtering it to an exact match on `internal` — what this function did
 * before — makes every approved row invisible to the internal assistant the moment a single row
 * is tagged `internal`. That was the live shape of the registry for months: 27 rows, all `public`,
 * none `internal`, so `listDatasets` returned zero to the internal assistant, silently, until a
 * live end-to-end run surfaced it.
 *
 * The mock builder here deliberately DOES apply `.eq()`, unlike `dataset-registry-scope.test.ts`'s
 * no-op one — that file exercises the dataset-slug scope, which is applied after the fetch in
 * plain code, so a no-op `.eq()` doesn't hide anything there. Here the exposure filter IS the
 * thing under test, so a mock that ignores it would pass whether the fix existed or not.
 */

const PUBLIC_ROW = row(1, "agg_bhw_counts", "public");
const INTERNAL_ROW = row(2, "fact_bhw_raw", "internal");
const REGISTRY: RegistryRow[] = [PUBLIC_ROW, INTERNAL_ROW];

function row(registry_id: number, table_name: string, exposure: string): RegistryRow {
  return {
    registry_id,
    table_name,
    title: table_name,
    summary: "s",
    grain: "one row",
    dataset_slug: null,
    exposure,
    row_estimate: 1,
    source_kind: "hand_written",
    status: "approved",
    notes_md: null,
    doc_path: null,
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
  };
}

const COLUMNS: ColumnRow[] = REGISTRY.map((r) => ({
  column_id: r.registry_id,
  registry_id: r.registry_id,
  column_name: "geo_code",
  ordinal: 1,
  data_type: "text",
  allowed_values: null,
  meaning: "Geography.",
  unit: null,
  role: "key",
  is_join_key: true,
  joins_to: "dim_geo.geo_code",
  is_queryable: true,
  distinct_count: null,
  null_rate: null,
  min_value: null,
  max_value: null,
  sample_values: null,
  profiled_at: null,
  status: "approved",
}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock("./service-client", () => ({ createSupabaseServiceClient }));

const { listRegisteredDatasets, getRegisteredDataset } = await import("./dataset-registry");

/** A builder that actually filters on `.eq()`, so the exposure clause under test has real teeth. */
function registryClient() {
  return {
    from(table: string) {
      if (table !== "dataset_registry") {
        return {
          select: () => ({ in: () => Promise.resolve({ data: COLUMNS, error: null }) }),
        };
      }
      let rows = REGISTRY;
      const builder = {
        select: () => builder,
        eq(column: string, value: string) {
          rows = rows.filter((r) => (r as Record<string, unknown>)[column] === value);
          return builder;
        },
        order: () => Promise.resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  createSupabaseServiceClient.mockReset();
  createSupabaseServiceClient.mockImplementation(registryClient);
});

const tables = async (exposure?: "public" | "internal") =>
  (await listRegisteredDatasets(exposure)).map((d) => d.tableName).sort();

describe("listRegisteredDatasets exposure filtering", () => {
  it("`public` sees only the public row — the real boundary, still exact", async () => {
    expect(await tables("public")).toEqual(["agg_bhw_counts"]);
  });

  it("`internal` sees BOTH rows — the superset, not a mirrored exact match", async () => {
    expect(await tables("internal")).toEqual(["agg_bhw_counts", "fact_bhw_raw"]);
  });

  it("regression: `internal` must not go empty when at least one row is tagged `internal`", async () => {
    // This is the exact live shape that broke: adding the FIRST internal-tagged row must not make
    // every previously-visible public row disappear from the internal assistant's view.
    const seenByInternal = await tables("internal");
    expect(seenByInternal.length).toBeGreaterThan(0);
    expect(seenByInternal).toContain("agg_bhw_counts");
  });

  it("a public caller never sees the internal-only row, regardless of the fix", async () => {
    expect(await tables("public")).not.toContain("fact_bhw_raw");
  });
});

describe("getRegisteredDataset exposure filtering", () => {
  it("the internal assistant can resolve a table that is only tagged public", async () => {
    expect((await getRegisteredDataset("agg_bhw_counts", "internal"))?.tableName).toBe("agg_bhw_counts");
  });

  it("the internal assistant can also resolve the internal-only table", async () => {
    expect((await getRegisteredDataset("fact_bhw_raw", "internal"))?.tableName).toBe("fact_bhw_raw");
  });

  it("a public caller cannot resolve the internal-only table", async () => {
    expect(await getRegisteredDataset("fact_bhw_raw", "public")).toBeNull();
  });
});
