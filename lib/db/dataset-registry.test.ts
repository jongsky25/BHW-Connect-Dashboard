import { describe, expect, it } from "vitest";
import {
  describeDataset,
  measureColumns,
  queryableColumns,
  toRegisteredDataset,
} from "./dataset-registry";
import type { Database } from "./database.types";

type RegistryRow = Database["public"]["Tables"]["dataset_registry"]["Row"];
type ColumnRow = Database["public"]["Tables"]["dataset_column"]["Row"];

function registry(overrides: Partial<RegistryRow> = {}): RegistryRow {
  return {
    registry_id: 1,
    table_name: "agg_demographics",
    title: "BHW demographics by geography",
    summary: "Counts and shares of profiled BHWs by demographic dimension.",
    grain: "One geography x dimension x category per dataset.",
    dataset_slug: "bhw-2025",
    exposure: "public",
    row_estimate: 530465,
    source_kind: "hand_written",
    status: "approved",
    notes_md: "Where is_suppressed is true, n and pct are withheld (fewer than 5 people).",
    doc_path: null,
    created_at: "2026-08-26T00:00:00Z",
    updated_at: "2026-08-26T00:00:00Z",
    ...overrides,
  };
}

function column(overrides: Partial<ColumnRow> = {}): ColumnRow {
  return {
    column_id: 1,
    registry_id: 1,
    column_name: "n",
    ordinal: 7,
    data_type: "integer",
    allowed_values: null,
    meaning: "Profiled BHWs in this category.",
    unit: "count",
    role: "measure",
    is_join_key: false,
    joins_to: null,
    is_queryable: true,
    distinct_count: null,
    null_rate: null,
    min_value: null,
    max_value: null,
    sample_values: null,
    profiled_at: null,
    status: "approved",
    ...overrides,
  };
}

describe("toRegisteredDataset", () => {
  it("keeps only approved columns, in ordinal order", () => {
    const dataset = toRegisteredDataset(registry(), [
      column({ column_id: 2, column_name: "n", ordinal: 7 }),
      column({ column_id: 1, column_name: "geo_code", ordinal: 3, role: "key" }),
      column({ column_id: 3, column_name: "pct", ordinal: 8, status: "auto" }),
    ]);

    expect(dataset?.columns.map((c) => c.name)).toEqual(["geo_code", "n"]);
  });

  it("ignores columns belonging to another registry entry", () => {
    const dataset = toRegisteredDataset(registry(), [
      column({ column_id: 1, column_name: "n" }),
      column({ column_id: 2, registry_id: 99, column_name: "gini" }),
    ]);

    expect(dataset?.columns.map((c) => c.name)).toEqual(["n"]);
  });

  it("drops a column whose role is outside the known vocabulary", () => {
    const dataset = toRegisteredDataset(registry(), [
      column({ column_id: 1, column_name: "n" }),
      column({ column_id: 2, column_name: "mystery", role: "fact" }),
    ]);

    expect(dataset?.columns.map((c) => c.name)).toEqual(["n"]);
  });

  it("refuses a dataset with no approved dictionary — there is nothing to allowlist against", () => {
    expect(toRegisteredDataset(registry(), [])).toBeNull();
    expect(toRegisteredDataset(registry(), [column({ status: "auto" })])).toBeNull();
  });

  it("refuses an exposure outside the known vocabulary rather than assuming it is safe", () => {
    expect(toRegisteredDataset(registry({ exposure: "semi_public" }), [column()])).toBeNull();
  });
});

describe("column selection", () => {
  const dataset = toRegisteredDataset(registry(), [
    column({ column_id: 1, column_name: "id", ordinal: 1, role: "meta", is_queryable: false }),
    column({
      column_id: 2,
      column_name: "geo_code",
      ordinal: 3,
      role: "key",
      is_join_key: true,
      joins_to: "dim_geo.geo_code",
    }),
    column({ column_id: 3, column_name: "category", ordinal: 6, role: "dimension", unit: null }),
    column({ column_id: 4, column_name: "n", ordinal: 7, role: "measure" }),
  ])!;

  it("never offers a non-queryable column", () => {
    expect(queryableColumns(dataset).map((c) => c.name)).toEqual(["geo_code", "category", "n"]);
  });

  it("counts only measures as figures a number may come from", () => {
    expect(measureColumns(dataset).map((c) => c.name)).toEqual(["n"]);
  });
});

describe("describeDataset", () => {
  const dataset = toRegisteredDataset(registry(), [
    column({
      column_id: 1,
      column_name: "id",
      ordinal: 1,
      role: "meta",
      is_queryable: false,
      meaning: "Surrogate row identifier.",
    }),
    column({
      column_id: 2,
      column_name: "geo_code",
      ordinal: 3,
      role: "key",
      unit: null,
      is_join_key: true,
      joins_to: "dim_geo.geo_code",
      meaning: "Geography this breakdown covers.",
    }),
    column({
      column_id: 3,
      column_name: "dimension",
      ordinal: 5,
      role: "dimension",
      unit: null,
      data_type: "demographic_dimension_enum",
      allowed_values: ["sex", "age_band"],
      meaning: "Which breakdown this row belongs to.",
    }),
    column({ column_id: 4, column_name: "n", ordinal: 7 }),
  ])!;

  const described = describeDataset(dataset);

  it("states the grain, since misreading it is how a generic tool double-counts", () => {
    expect(described).toContain("One row = One geography x dimension x category per dataset.");
  });

  it("shows type, role, unit and meaning per column", () => {
    expect(described).toContain("n (integer, measure, count): Profiled BHWs in this category.");
  });

  it("shows the closed value set and the join target where there is one", () => {
    expect(described).toContain("Values: sex, age_band.");
    expect(described).toContain("Joins to dim_geo.geo_code.");
  });

  it("omits columns the query tool may not touch", () => {
    expect(described).not.toContain("Surrogate row identifier");
  });

  it("carries the suppression caveat through to what the model reads", () => {
    expect(described).toContain("CAVEATS: Where is_suppressed is true");
  });
});
