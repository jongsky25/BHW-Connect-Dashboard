import "server-only";
import { createSupabaseServiceClient } from "./service-client";
import type { Database } from "./database.types";

/**
 * The dataset registry (docs/AI_ASSISTANT_PLAN.md §3, Increments 1.1–1.2): what the internal
 * assistant is *shown* before it composes a query, and the allowlist that bounds what it may
 * query at all.
 *
 * Two rules hold everywhere in this module:
 *
 * 1. **Only approved rows are usable.** A registry or column row with `status = 'auto'` is a
 *    proposal from the ingest-time profiling pass (Phase 4), not a description anyone has
 *    checked; serving one would let an inferred column meaning become a stated fact. Filtering
 *    happens in the query, not in a caller, so there is no path that forgets.
 * 2. **`exposure` is a boundary, not a hint.** `internal` tables (`fact_*`/raw) exist in this
 *    registry so the internal assistant can reach them; a public-facing caller must pass
 *    `exposure: "public"` and gets exactly the layer the public tools already read.
 *
 * Reads go through the service-role client because both tables are service-role only — they carry
 * the exposure flag itself, so publishing them under RLS would hand out the map of what is meant
 * to stay internal. Every caller must therefore itself be `server-only`.
 */

export type ColumnRole = "key" | "dimension" | "measure" | "meta";
export type Exposure = "public" | "internal";

export type RegisteredColumn = {
  name: string;
  dataType: string;
  /** Enum labels, or the closed category set of a text column that behaves like one. */
  allowedValues: string[] | null;
  meaning: string;
  /** What the number is in — 'count', 'percent (0-100)', 'PHP per month'. Null for non-numerics. */
  unit: string | null;
  role: ColumnRole;
  isJoinKey: boolean;
  /** `dim_geo.geo_code` — the join target, restated as a `joins-on` edge in Increment 1.5. */
  joinsTo: string | null;
  /** False for columns a generic query tool must never select or filter on (tsvector, surrogate ids). */
  isQueryable: boolean;
};

export type RegisteredDataset = {
  tableName: string;
  title: string;
  summary: string;
  /** What exactly one row is. Misreading the grain is how a generic tool double-counts. */
  grain: string;
  datasetSlug: string | null;
  exposure: Exposure;
  /** Advisory row count as of the last profile — a weight cue, never a figure to state. */
  rowEstimate: number | null;
  /** Caveats that change how an answer must be phrased: suppression, denominators, missing levels. */
  notesMd: string | null;
  docPath: string | null;
  columns: RegisteredColumn[];
};

type RegistryRow = Database["public"]["Tables"]["dataset_registry"]["Row"];
type ColumnRow = Database["public"]["Tables"]["dataset_column"]["Row"];

const COLUMN_ROLES: readonly string[] = ["key", "dimension", "measure", "meta"];

/** A row whose role or exposure is outside the known vocabulary is dropped rather than coerced:
 * an unrecognized value means the row was written by something this build does not understand. */
function toColumn(row: ColumnRow): RegisteredColumn | null {
  if (!COLUMN_ROLES.includes(row.role)) return null;
  return {
    name: row.column_name,
    dataType: row.data_type,
    allowedValues: row.allowed_values,
    meaning: row.meaning,
    unit: row.unit,
    role: row.role as ColumnRole,
    isJoinKey: row.is_join_key,
    joinsTo: row.joins_to,
    isQueryable: row.is_queryable,
  };
}

export function toRegisteredDataset(
  registry: RegistryRow,
  columns: ColumnRow[],
): RegisteredDataset | null {
  if (registry.exposure !== "public" && registry.exposure !== "internal") return null;

  const mapped = columns
    .filter((c) => c.registry_id === registry.registry_id && c.status === "approved")
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(toColumn)
    .filter((c): c is RegisteredColumn => c !== null);

  // A registry entry with no usable dictionary cannot be queried safely — there is nothing to
  // allowlist against — so it is not a dataset this module will hand out.
  if (mapped.length === 0) return null;

  return {
    tableName: registry.table_name,
    title: registry.title,
    summary: registry.summary,
    grain: registry.grain,
    datasetSlug: registry.dataset_slug,
    exposure: registry.exposure,
    rowEstimate: registry.row_estimate,
    notesMd: registry.notes_md,
    docPath: registry.doc_path,
    columns: mapped,
  };
}

/** Columns a generic query tool may select, filter or group by. */
export function queryableColumns(dataset: RegisteredDataset): RegisteredColumn[] {
  return dataset.columns.filter((c) => c.isQueryable);
}

/** Columns that may back a stated number. Measures only — a count of surrogate ids is not a fact. */
export function measureColumns(dataset: RegisteredDataset): RegisteredColumn[] {
  return dataset.columns.filter((c) => c.isQueryable && c.role === "measure");
}

/**
 * The registry rendered for a model: a compact data dictionary, one line per queryable column.
 * Caveats come last and unindented so a long dictionary cannot push them out of sight — a
 * suppression rule that the model skims past is how a suppressed cell gets stated.
 */
export function describeDataset(dataset: RegisteredDataset): string {
  const header = `TABLE ${dataset.tableName} — ${dataset.title}\n${dataset.summary}\nOne row = ${dataset.grain}`;
  const size =
    dataset.rowEstimate === null
      ? ""
      : `\nApprox. ${dataset.rowEstimate.toLocaleString("en-US")} rows.`;

  const columns = queryableColumns(dataset)
    .map((c) => {
      const parts = [`  ${c.name} (${c.dataType}, ${c.role}`];
      if (c.unit) parts.push(`, ${c.unit}`);
      parts.push(`): ${c.meaning}`);
      if (c.allowedValues?.length) parts.push(` Values: ${c.allowedValues.join(", ")}.`);
      if (c.joinsTo) parts.push(` Joins to ${c.joinsTo}.`);
      return parts.join("");
    })
    .join("\n");

  const notes = dataset.notesMd ? `\nCAVEATS: ${dataset.notesMd}` : "";
  return `${header}${size}\nCOLUMNS:\n${columns}${notes}`;
}

/**
 * Whether a relation is inside a caller's dataset scope. No scope means every relation the
 * exposure allows, which is what the internal assistant and the pre-U8 callers get.
 *
 * A relation with a null `dataset_slug` is in *every* scope. Those are the structural ones —
 * `dim_geo`, `dim_dataset` — and they are the coordinate system datasets are expressed in rather
 * than datasets of their own; a scope without them cannot resolve a place name, or tell a
 * geography this dataset does not cover apart from one that does not exist.
 */
function inDatasetScope(dataset: RegisteredDataset, datasetSlugs?: readonly string[]): boolean {
  if (!datasetSlugs) return true;
  return dataset.datasetSlug === null || datasetSlugs.includes(dataset.datasetSlug);
}

async function fetchRegistry(
  exposure?: Exposure,
  datasetSlugs?: readonly string[],
): Promise<RegisteredDataset[]> {
  const supabase = createSupabaseServiceClient();

  let registryQuery = supabase.from("dataset_registry").select("*").eq("status", "approved");
  if (exposure) registryQuery = registryQuery.eq("exposure", exposure);

  const { data: registries, error } = await registryQuery.order("table_name");
  if (error || !registries || registries.length === 0) return [];

  const { data: columns, error: columnError } = await supabase
    .from("dataset_column")
    .select("*")
    .in(
      "registry_id",
      registries.map((r) => r.registry_id),
    );
  if (columnError || !columns) return [];

  // Scoping happens here, in the module's single fetch path, for the same reason the `approved`
  // filter does: both public entry points go through it, so there is no caller that can forget.
  return registries
    .map((registry) => toRegisteredDataset(registry, columns))
    .filter((d): d is RegisteredDataset => d !== null && inDatasetScope(d, datasetSlugs));
}

/**
 * Every approved dataset, with its dictionary. Returns an empty list on any read failure rather
 * than throwing — the assistant degrades to the hand-written tools, which is the existing
 * "degrade, never error" contract, not a silent wrong answer.
 */
export async function listRegisteredDatasets(
  exposure?: Exposure,
  datasetSlugs?: readonly string[],
): Promise<RegisteredDataset[]> {
  try {
    return await fetchRegistry(exposure, datasetSlugs);
  } catch {
    return [];
  }
}

/**
 * One dataset by table name. Null when the table is unregistered, unapproved, or outside the
 * requested exposure — the three cases a query tool must refuse rather than attempt.
 */
export async function getRegisteredDataset(
  tableName: string,
  exposure?: Exposure,
  datasetSlugs?: readonly string[],
): Promise<RegisteredDataset | null> {
  const datasets = await listRegisteredDatasets(exposure, datasetSlugs);
  return datasets.find((d) => d.tableName === tableName) ?? null;
}
