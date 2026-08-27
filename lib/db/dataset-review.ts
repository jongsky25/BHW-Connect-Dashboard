import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Read and write layer for the profiled-dataset review queue (docs/AI_ASSISTANT_PLAN.md §8, 4.1).
 *
 * WHY THIS IS A SECOND QUEUE AND NOT A ROW IN THE FIRST. `kb-review.ts` gates *extracted* graph
 * rows: a model read a slide and proposed a fact, and the reviewer's question is "does the quote
 * say that". The question here is a different one — "is this dictionary right, and may the
 * assistant query this table" — and its evidence is a column profile rather than a sentence. The
 * two share a shape (`status = 'auto'` until a person decides) and nothing else, so they share the
 * page and not the module.
 *
 * WHAT APPROVAL ACTUALLY GRANTS, WHICH IS MORE THAN THE GRAPH QUEUE GRANTS. Approving a `kb_edge`
 * makes one fact traversable. Approving a `dataset_registry` row makes a whole table **queryable**:
 * `lib/db/dataset-registry.ts` filters to `status = 'approved'`, and `queryDataset`'s allowlist is
 * exactly that set. So this is the queue where a careless approval hands the assistant a table, and
 * two rules follow from it:
 *
 *   1. **A dataset and its columns are approved separately.** The registry read layer requires both
 *      — an approved dataset whose columns are all still `auto` exposes no columns and is
 *      therefore inert. That is the safe direction, and it lets a reviewer accept a table while
 *      still holding back the one column whose meaning is a placeholder.
 *   2. **Exposure is never widened here.** `profile_dataset()` writes `internal` and this module
 *      never writes `exposure` at all. Guardrail 5 keeps public tools on the `agg_*`/`dim_*` layer;
 *      moving a profiled fact table onto a public surface is a decision with its own increment,
 *      not a checkbox on a review card.
 *
 * A COLUMN STILL CARRYING ITS PLACEHOLDER IS THE THING TO LOOK AT. `profile_dataset()` writes
 * `(needs review) …` into `meaning` when nothing in the approved dictionary describes a column, and
 * the registry is what the model is *shown* — so an approved placeholder is not a cosmetic blemish,
 * it is a column the assistant will be asked to reason about with no idea what it holds. The reads
 * below flag those rows so the reviewer sorts by them rather than scrolling for them.
 *
 * Service-role only. Reads degrade to empty rather than throwing; writes return their error text,
 * for the reason `kb-review.ts` gives — a reviewer told nothing cannot know whether it worked.
 */

export type ReviewStatus = "approved" | "rejected";

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "approved" || value === "rejected";
}

/** The marker `profile_dataset()` writes when no approved dictionary describes a column. */
export const NEEDS_REVIEW_PREFIX = "(needs review)";

export function needsReview(text: string | null | undefined): boolean {
  return (text ?? "").trimStart().startsWith(NEEDS_REVIEW_PREFIX);
}

export type PendingColumn = {
  columnId: number;
  columnName: string;
  dataType: string;
  meaning: string;
  role: string;
  isJoinKey: boolean;
  joinsTo: string | null;
  isQueryable: boolean;
  distinctCount: number | null;
  nullRate: number | null;
  sampleValues: string[] | null;
  /** True when `meaning` is still the profiler's placeholder — the rows to look at first. */
  placeholder: boolean;
};

export type PendingDataset = {
  registryId: number;
  tableName: string;
  title: string;
  summary: string;
  grain: string;
  exposure: string;
  rowEstimate: number | null;
  sourceKind: string;
  columns: PendingColumn[];
  /** How many of this dataset's pending columns still carry a placeholder meaning. */
  placeholderCount: number;
};

type RegistryRow = {
  registry_id: number;
  table_name: string;
  title: string;
  summary: string;
  grain: string;
  exposure: string;
  row_estimate: number | null;
  source_kind: string;
};

type ColumnRow = {
  column_id: number;
  registry_id: number;
  column_name: string;
  ordinal: number;
  data_type: string;
  meaning: string;
  role: string;
  is_join_key: boolean;
  joins_to: string | null;
  is_queryable: boolean;
  distinct_count: number | null;
  null_rate: number | null;
  sample_values: string[] | null;
};

/**
 * Datasets awaiting review, with their pending columns.
 *
 * A dataset appears while *either* it or any of its columns is still `auto`, which is what makes
 * the partial approvals above visible: approve the table, leave one column pending, and the card
 * stays with the single row still needing a decision rather than vanishing with work outstanding.
 */
export async function listPendingDatasets(limit = 50): Promise<PendingDataset[]> {
  try {
    const supabase = createSupabaseServiceClient();

    const [pendingRegistry, pendingColumns] = await Promise.all([
      supabase
        .from("dataset_registry")
        .select(
          "registry_id, table_name, title, summary, grain, exposure, row_estimate, source_kind",
        )
        .eq("status", "auto")
        .order("table_name")
        .limit(limit),
      supabase
        .from("dataset_column")
        .select(
          "column_id, registry_id, column_name, ordinal, data_type, meaning, role, is_join_key, " +
            "joins_to, is_queryable, distinct_count, null_rate, sample_values",
        )
        .eq("status", "auto")
        .order("ordinal"),
    ]);

    // `as unknown as`, the same hop kb-review.ts makes on its edge rows. The cause is the
    // concatenated `.select()` string above: the Supabase client infers a row type by parsing that
    // string at the type level, and a value built by `+` is not a literal it can read, so `data`
    // degrades to `GenericStringError[]` and a direct cast is rejected. Not a stale-types problem —
    // it still holds against the regenerated `database.types.ts`, which was checked.
    const columns = (pendingColumns.data ?? []) as unknown as ColumnRow[];
    const registryIds = new Set<number>(columns.map((c) => c.registry_id));
    const known = new Map<number, RegistryRow>();
    for (const row of (pendingRegistry.data ?? []) as RegistryRow[]) {
      known.set(row.registry_id, row);
      registryIds.add(row.registry_id);
    }

    // A column can be pending under a dataset that is already approved — the partial-approval case
    // above. Those parent rows are fetched separately rather than left out, so the reviewer sees
    // the table the column belongs to.
    const missing = [...registryIds].filter((id) => !known.has(id));
    if (missing.length > 0) {
      const { data } = await supabase
        .from("dataset_registry")
        .select(
          "registry_id, table_name, title, summary, grain, exposure, row_estimate, source_kind",
        )
        .in("registry_id", missing);
      for (const row of (data ?? []) as RegistryRow[]) known.set(row.registry_id, row);
    }

    const result: PendingDataset[] = [];
    for (const registryId of registryIds) {
      const registry = known.get(registryId);
      if (!registry) continue;
      const mine = columns
        .filter((c) => c.registry_id === registryId)
        .map((c) => ({
          columnId: c.column_id,
          columnName: c.column_name,
          dataType: c.data_type,
          meaning: c.meaning,
          role: c.role,
          isJoinKey: c.is_join_key,
          joinsTo: c.joins_to,
          isQueryable: c.is_queryable,
          distinctCount: c.distinct_count,
          nullRate: c.null_rate,
          sampleValues: c.sample_values,
          placeholder: needsReview(c.meaning),
        }));
      result.push({
        registryId,
        tableName: registry.table_name,
        title: registry.title,
        summary: registry.summary,
        grain: registry.grain,
        exposure: registry.exposure,
        rowEstimate: registry.row_estimate,
        sourceKind: registry.source_kind,
        columns: mine,
        placeholderCount: mine.filter((c) => c.placeholder).length,
      });
    }
    return result.sort((a, b) => a.tableName.localeCompare(b.tableName));
  } catch {
    return [];
  }
}

export type DatasetReviewCounts = {
  pendingDatasets: number;
  pendingColumns: number;
  placeholderColumns: number;
  approvedDatasets: number;
  profiledDatasets: number;
};

export async function getDatasetReviewCounts(): Promise<DatasetReviewCounts> {
  const zero: DatasetReviewCounts = {
    pendingDatasets: 0,
    pendingColumns: 0,
    placeholderColumns: 0,
    approvedDatasets: 0,
    profiledDatasets: 0,
  };
  try {
    const supabase = createSupabaseServiceClient();
    const head = { count: "exact" as const, head: true };
    const [pendingDatasets, pendingColumns, placeholders, approvedDatasets, profiled] =
      await Promise.all([
        supabase.from("dataset_registry").select("registry_id", head).eq("status", "auto"),
        supabase.from("dataset_column").select("column_id", head).eq("status", "auto"),
        supabase
          .from("dataset_column")
          .select("column_id", head)
          .eq("status", "auto")
          .like("meaning", `${NEEDS_REVIEW_PREFIX}%`),
        supabase.from("dataset_registry").select("registry_id", head).eq("status", "approved"),
        supabase.from("dataset_registry").select("registry_id", head).eq("source_kind", "profiled"),
      ]);
    return {
      pendingDatasets: pendingDatasets.count ?? 0,
      pendingColumns: pendingColumns.count ?? 0,
      placeholderColumns: placeholders.count ?? 0,
      approvedDatasets: approvedDatasets.count ?? 0,
      profiledDatasets: profiled.count ?? 0,
    };
  } catch {
    return zero;
  }
}

/**
 * The two tables are stamped differently, and not by oversight: `dataset_registry` carries
 * `updated_at` and `dataset_column` does not — 1.1 gave the column table `profiled_at` instead,
 * because what matters about a column row is when it was measured, not when it was last touched.
 * Writing one shared object into both is what the generated types caught.
 */
function registryReviewFields(status: ReviewStatus) {
  return { status, updated_at: new Date().toISOString() };
}

/**
 * Judging the dataset row itself. Scoped `.eq("status", "auto")` so a second click on a stale page
 * cannot re-decide something already settled — `kb-review.ts`'s rule, for the same reason.
 *
 * Note what this does *not* touch: `exposure`. See the module header.
 */
export async function judgeDataset(
  registryId: number,
  status: ReviewStatus,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("dataset_registry")
      .update(registryReviewFields(status))
      .eq("registry_id", registryId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

export async function judgeDatasetColumn(
  columnId: number,
  status: ReviewStatus,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("dataset_column")
      .update({ status })
      .eq("column_id", columnId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

/**
 * Writing the meaning a profile could not supply.
 *
 * This is the one edit that matters on this queue. `profile_dataset()` deliberately leaves a
 * visible placeholder rather than inventing a description (see the migration's header), so a
 * reviewer writing the real meaning here is the step that turns a profiled column into a
 * documented one. Editing is confined to `auto` rows: an approved dictionary is changed by
 * re-profiling with `p_force`, which returns it to this queue, rather than by a silent update
 * nobody reviews.
 */
export async function editDatasetColumnMeaning(
  columnId: number,
  meaning: string,
  unit: string | null,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("dataset_column")
      .update({ meaning, unit })
      .eq("column_id", columnId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

/**
 * Approving every column of one dataset at once.
 *
 * Present because the alternative is worse, not because bulk approval is good: a 26-column fact
 * table reviewed one button at a time is 26 clicks, and a queue that costs 26 clicks per table is
 * one that gets skipped. It deliberately **refuses while any column still carries a placeholder
 * meaning** — the count is returned so the caller can say which — so the shortcut cannot be the way
 * an undocumented column reaches the assistant. Judging those rows individually is still allowed;
 * this is the "I have read all of these" button, and it should only be available when there is
 * nothing left to write.
 */
export async function approveAllColumns(
  registryId: number,
): Promise<{ error: string | null; approved: number; blockedByPlaceholder: number }> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data: pending, error: readError } = await supabase
      .from("dataset_column")
      .select("column_id, meaning")
      .eq("registry_id", registryId)
      .eq("status", "auto");
    if (readError) return { error: readError.message, approved: 0, blockedByPlaceholder: 0 };

    const rows = (pending ?? []) as { column_id: number; meaning: string }[];
    const blocked = rows.filter((r) => needsReview(r.meaning));
    if (blocked.length > 0) {
      return {
        error: `${blocked.length} column(s) still carry a placeholder meaning. Write those first.`,
        approved: 0,
        blockedByPlaceholder: blocked.length,
      };
    }
    if (rows.length === 0) return { error: null, approved: 0, blockedByPlaceholder: 0 };

    const { error } = await supabase
      .from("dataset_column")
      .update({ status: "approved" })
      .eq("registry_id", registryId)
      .eq("status", "auto");
    return error
      ? { error: error.message, approved: 0, blockedByPlaceholder: 0 }
      : { error: null, approved: rows.length, blockedByPlaceholder: 0 };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "the update did not complete",
      approved: 0,
      blockedByPlaceholder: 0,
    };
  }
}
