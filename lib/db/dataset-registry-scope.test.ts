import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./database.types";

type RegistryRow = Database["public"]["Tables"]["dataset_registry"]["Row"];
type ColumnRow = Database["public"]["Tables"]["dataset_column"]["Row"];

/**
 * The dataset-slug scope on the registry fetch path (plan U8).
 *
 * `exposure` alone would hand `/uuc-phc`'s public chat all 26 public relations, the BHW census
 * aggregates included — nothing unsafe, since `anon` can already read every one of them, but it
 * would make the two sections answer each other's questions by construction. That is the same
 * wrong-dataset confusion §8 defects 2 and 3 describe, arriving through the front door instead of
 * through a cache, and it would not be visible in any answer.
 *
 * The filter lives in `fetchRegistry`, the module's single fetch path, so both public entry points
 * inherit it — which is what these tests actually pin: that `getRegisteredDataset` is scoped too,
 * not only the catalogue. A model that names a table it was never shown has to be refused by the
 * function that would read it, or the catalogue is advice rather than a boundary.
 */

const REGISTRY: RegistryRow[] = [
  row(1, "agg_uuc_phc_counts", "uuc-phc-2025"),
  row(2, "fact_uuc_phc_indicators", "uuc-phc-2025"),
  row(3, "agg_bhw_counts", "bhw-2025"),
  row(4, "agg_poverty", "psa-sae-poverty-2023"),
  // Structural: not a dataset of its own, so it belongs to every scope.
  row(5, "dim_geo", null),
];

function row(registry_id: number, table_name: string, dataset_slug: string | null): RegistryRow {
  return {
    registry_id,
    table_name,
    title: table_name,
    summary: "s",
    grain: "one row",
    dataset_slug,
    exposure: "public",
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

beforeEach(() => {
  createSupabaseServiceClient.mockReset();
  createSupabaseServiceClient.mockImplementation(() => ({
    from(table: string) {
      const data = table === "dataset_registry" ? REGISTRY : COLUMNS;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => Promise.resolve({ data, error: null });
      builder.order = () => Promise.resolve({ data, error: null });
      return builder;
    },
  }));
});

const tables = async (slugs?: string[]) =>
  (await listRegisteredDatasets("public", slugs)).map((d) => d.tableName).sort();

describe("listRegisteredDatasets with a dataset scope", () => {
  it("returns every relation the exposure allows when no scope is given", async () => {
    expect(await tables()).toEqual([
      "agg_bhw_counts",
      "agg_poverty",
      "agg_uuc_phc_counts",
      "dim_geo",
      "fact_uuc_phc_indicators",
    ].sort());
  });

  it("narrows to one dataset's relations, and keeps the structural ones", async () => {
    expect(await tables(["uuc-phc-2025"])).toEqual([
      "agg_uuc_phc_counts",
      "dim_geo",
      "fact_uuc_phc_indicators",
    ]);
  });

  it("excludes the neighbouring sections' datasets", async () => {
    const scoped = await tables(["uuc-phc-2025"]);
    expect(scoped).not.toContain("agg_bhw_counts");
    expect(scoped).not.toContain("agg_poverty");
  });

  it("accepts more than one slug", async () => {
    expect(await tables(["uuc-phc-2025", "bhw-2025"])).toEqual([
      "agg_bhw_counts",
      "agg_uuc_phc_counts",
      "dim_geo",
      "fact_uuc_phc_indicators",
    ]);
  });

  it("returns only the structural relations for a slug nothing carries", async () => {
    expect(await tables(["no-such-dataset"])).toEqual(["dim_geo"]);
  });
});

describe("getRegisteredDataset with a dataset scope", () => {
  it("resolves a table inside the scope", async () => {
    expect((await getRegisteredDataset("agg_uuc_phc_counts", "public", ["uuc-phc-2025"]))?.tableName).toBe(
      "agg_uuc_phc_counts",
    );
  });

  it("refuses a table outside it, even though the exposure would allow it", async () => {
    expect(await getRegisteredDataset("agg_bhw_counts", "public", ["uuc-phc-2025"])).toBeNull();
    // …and still resolves without a scope, so this is the scope refusing rather than the fixture.
    expect((await getRegisteredDataset("agg_bhw_counts", "public"))?.tableName).toBe("agg_bhw_counts");
  });

  it("keeps the structural relations reachable inside a scope", async () => {
    // dim_geo is what lets an answer tell "not on the 2025 list" apart from "no such barangay".
    expect((await getRegisteredDataset("dim_geo", "public", ["uuc-phc-2025"]))?.tableName).toBe("dim_geo");
  });
});
