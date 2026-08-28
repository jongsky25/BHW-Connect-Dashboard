import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Read and write layer for the contradiction queue (docs/AI_ASSISTANT_PLAN.md §8, 4.2).
 *
 * WHY THIS IS A THIRD QUEUE. `kb-review.ts` gates rows a model proposed — "does the quote say
 * that". `dataset-review.ts` gates a dictionary — "is this right, and may the assistant query this
 * table". The question here is neither: **"are these two numbers the same measure?"** The rows are
 * not proposals a model made and not documentation anyone wrote; `sweep_contradictions()` computed
 * them from the corpus and the registry, and what a person adds is the judgement no arithmetic can
 * reach. Same shape as the other two (`status = 'auto'` until someone decides), different question,
 * so it shares the page and not the module.
 *
 * APPROVING A ROW DOES NOT RESOLVE IT — THAT IS THE WHOLE POINT. §12.4 rule 3: the cue cards'
 * 277,767 and SQL's 270,917 "are not a contradiction to resolve, they are different measures at
 * different dates, and an assistant that picks one is hiding the distinction a budget discussion
 * actually turns on." So the two judgements read:
 *
 *   approved — the pairing is real: these two numbers ARE about the same thing, and an answer that
 *              quotes either must surface both with their as-of dates.
 *   rejected — the pairing is spurious: they are different quantities that happened to be close,
 *              and the sweep matched them on evidence too thin.
 *
 * Neither judgement says which number is right, and there is deliberately no control that says so.
 * A queue offering "correct value" would invite exactly the silent preference the rule forbids.
 *
 * A ROW THAT NO LONGER REPRODUCES IS NOT DELETED. Every sweep stamps `last_swept_at` on the rows
 * it re-finds; a row left behind means the disagreement is gone — the data changed, or the document
 * was re-ingested. Deleting it would erase a judgement someone made, so it is shown as stale
 * instead. `staleCount` is the number of such rows and `isStale` marks them on the card.
 *
 * Service-role only. Reads degrade to empty rather than throwing (`kb-review.ts`'s convention);
 * writes return their error text, for the reason that module gives — a reviewer told nothing cannot
 * know whether the row was judged.
 */

export type ReviewStatus = "approved" | "rejected";

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "approved" || value === "rejected";
}

/** How the sweep found a row. `geo_distribution` identifies its subject exactly; `scalar_magnitude`
 *  infers it, and a reviewer should be correspondingly more sceptical. */
export type SweepMethod = "geo_distribution" | "scalar_magnitude";

export type PendingContradiction = {
  contradictionId: number;
  method: SweepMethod | string;
  measureLabel: string;
  pageFrom: number;
  chunkId: number;
  docValue: number;
  docAsOf: string | null;
  /** The slide's own "as of …" phrase, verbatim. Often more specific than the document's date. */
  docAsOfText: string | null;
  evidenceQuote: string;
  dataTable: string;
  dataColumn: string | null;
  dataStat: string;
  dataValue: number;
  dataAsOf: string | null;
  geoName: string | null;
  relDifference: number;
  /** What the pass measured. Rendered on the card so the pairing is judged, not trusted. */
  evidence: SweepEvidence;
  /** True when the most recent sweep did not reproduce this row. */
  isStale: boolean;
};

export type SweepEvidence = {
  /** geo_distribution: cells compared, cells the structured side had, cells that agreed. */
  cells?: number;
  covered?: number;
  agreed?: number;
  fit?: number;
  dataRows?: number;
  /** Other (table, column) pairs that fitted exactly as well. Never empty by accident: an
   *  arbitrary pick among equals is only defensible if the reviewer can see the alternatives. */
  tiedCandidates: string[];
  /** scalar_magnitude: the non-generic words the slide and the registry entry share. */
  sharedTerms: string[];
  registryLabel: string | null;
};

export type ContradictionCounts = {
  pending: number;
  approved: number;
  rejected: number;
  /** Rows the latest sweep did not reproduce. */
  stale: number;
  lastSweptAt: string | null;
};

type ContradictionRow = {
  contradiction_id: number;
  method: string;
  measure_label: string;
  page_from: number;
  chunk_id: number;
  doc_value: number;
  doc_as_of: string | null;
  doc_as_of_text: string | null;
  evidence_quote: string;
  data_table: string;
  data_column: string | null;
  data_stat: string;
  data_value: number;
  data_as_of: string | null;
  geo_code: string | null;
  rel_difference: number;
  evidence: unknown;
  last_swept_at: string;
  status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

const COLUMNS =
  "contradiction_id, method, measure_label, page_from, chunk_id, doc_value, doc_as_of, " +
  "doc_as_of_text, evidence_quote, data_table, data_column, data_stat, data_value, data_as_of, " +
  "geo_code, rel_difference, evidence, last_swept_at, status, review_note, reviewed_by, reviewed_at";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Reads the jsonb the sweep wrote. Defensive because `evidence` is untyped in the schema on
 *  purpose: the two passes measure different things and a shared column shape would force one of
 *  them to record fields that mean nothing to it. */
export function readEvidence(value: unknown): SweepEvidence {
  const record = asRecord(value);
  return {
    cells: asNumber(record.cells),
    covered: asNumber(record.covered),
    agreed: asNumber(record.agreed),
    fit: asNumber(record.fit),
    dataRows: asNumber(record.data_rows),
    tiedCandidates: asStringArray(record.tied_candidates),
    sharedTerms: asStringArray(record.shared_terms),
    registryLabel: typeof record.registry_label === "string" ? record.registry_label : null,
  };
}

/**
 * How much a pairing can be trusted before its numbers are read.
 *
 * `exact` and `inferred` are the two passes; `unrecognised` is a `method` this build has no
 * description for. That third case is not defensive padding — it is the only honest reading of a
 * row written by a sweep newer than the page rendering it, and the alternative (falling back to
 * the slug and letting it read as a normal chip) would present an unjudgeable pairing as a
 * judgeable one.
 */
export type PairingStrength = "exact" | "inferred" | "unrecognised";

export type MethodDescription = {
  /** What to call the pass on screen. */
  name: string;
  strength: PairingStrength;
  /** What the pass matched on — the thing that decides how far to trust it. */
  basis: string;
};

/**
 * What the reviewer needs before the numbers: **which pass found this row**.
 *
 * §8 4.2 pairs two ways "of deliberately different strength", and the asymmetry is the whole
 * reason `method` is a column rather than an implementation detail. A `geo_distribution` row was
 * identified by a slide label that **is** a row in `dim_geo` — the subject is not in doubt, only
 * the number. A `scalar_magnitude` row was identified by two weak signals used together, and its
 * subject is a guess that happened to be selective. Those are not the same claim and must not read
 * as one, so the strength is named on the row rather than left for a reviewer to infer from the
 * slug.
 *
 * Exported for the reason `describeSides` is: one wording, used wherever these rows are met.
 */
export function describeMethod(method: string): MethodDescription {
  if (method === "geo_distribution") {
    return {
      name: "geography table",
      strength: "exact",
      basis:
        "Every label beside a number on the slide resolves to a row in dim_geo by name, so what " +
        "each figure is about is certain. The structured counterpart was then chosen by measured " +
        "fit across every registered measure column — that choice is what to check.",
    };
  }
  if (method === "scalar_magnitude") {
    return {
      name: "standalone figure",
      strength: "inferred",
      basis:
        "A figure in prose with no dimension row to match, paired on two weak signals used " +
        "together: the words around it share a non-generic term with the registry entry's name, " +
        "and the two values are close enough to be two measurements of one quantity. Treat the " +
        "subject itself as the claim under review.",
    };
  }
  return {
    name: method,
    strength: "unrecognised",
    basis:
      "This build has no description for that pass, so how the two sides were paired is unknown " +
      "and the pairing cannot be judged from this card.",
  };
}

/**
 * The two numbers a row carries, each with the date it speaks as of — the form §12.4 rule 3
 * requires an answer to take. Exported so the page and any later answer path phrase it the same
 * way rather than each inventing wording.
 */
export function describeSides(
  row: Pick<
    PendingContradiction,
    "docValue" | "docAsOf" | "docAsOfText" | "dataTable" | "dataColumn" | "dataValue" | "dataAsOf"
  >,
): {
  document: string;
  dataset: string;
} {
  const docDate =
    row.docAsOfText?.trim() || (row.docAsOf ? `as of ${row.docAsOf}` : "no stated date");
  const ref = row.dataColumn ? `${row.dataTable}.${row.dataColumn}` : row.dataTable;
  const dataDate = row.dataAsOf ? `as of ${row.dataAsOf}` : "no dataset as-of date recorded";
  return {
    document: `the document states ${row.docValue.toLocaleString()} (${docDate})`,
    dataset: `${ref} holds ${row.dataValue.toLocaleString()} (${dataDate})`,
  };
}

function toPending(
  row: ContradictionRow,
  geoNames: Map<string, string>,
  latestSweep: string | null,
): PendingContradiction {
  return {
    contradictionId: row.contradiction_id,
    method: row.method,
    measureLabel: row.measure_label,
    pageFrom: row.page_from,
    chunkId: row.chunk_id,
    docValue: Number(row.doc_value),
    docAsOf: row.doc_as_of,
    docAsOfText: row.doc_as_of_text,
    evidenceQuote: row.evidence_quote,
    dataTable: row.data_table,
    dataColumn: row.data_column,
    dataStat: row.data_stat,
    dataValue: Number(row.data_value),
    dataAsOf: row.data_as_of,
    geoName: row.geo_code ? (geoNames.get(row.geo_code) ?? row.geo_code) : null,
    relDifference: Number(row.rel_difference),
    evidence: readEvidence(row.evidence),
    isStale: latestSweep !== null && row.last_swept_at < latestSweep,
  };
}

async function resolveGeoNames(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("dim_geo")
    .select("geo_code, geo_name")
    .in("geo_code", unique);
  if (error || !data) return new Map();

  return new Map(data.map((row) => [row.geo_code, row.geo_name]));
}

/** The timestamp of the most recent sweep, used to tell a current row from a stale one. */
export async function getLastSweptAt(): Promise<string | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("kb_contradiction")
    .select("last_swept_at")
    .order("last_swept_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.last_swept_at;
}

/**
 * Rows awaiting judgement, widest disagreement first. Ordering by `rel_difference` rather than by
 * age is deliberate: a 96% gap and a 0.07% gap are not equally worth a reviewer's next minute, and
 * the largest gaps are also where a spurious pairing is most obvious.
 */
export async function listPendingContradictions(limit = 100): Promise<PendingContradiction[]> {
  const supabase = createSupabaseServiceClient();
  const [{ data, error }, latestSweep] = await Promise.all([
    supabase
      .from("kb_contradiction")
      .select(COLUMNS)
      .eq("status", "auto")
      .order("rel_difference", { ascending: false })
      .limit(limit),
    getLastSweptAt(),
  ]);
  if (error || !data) return [];

  const rows = data as unknown as ContradictionRow[];
  const geoNames = await resolveGeoNames(
    rows.map((row) => row.geo_code).filter((code): code is string => code !== null),
  );
  return rows.map((row) => toPending(row, geoNames, latestSweep));
}

export type JudgedContradiction = PendingContradiction & {
  status: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

/** The last judgements, so a mistake is visible and reversible rather than only reversible. */
export async function listRecentlyJudgedContradictions(limit = 10): Promise<JudgedContradiction[]> {
  const supabase = createSupabaseServiceClient();
  const [{ data, error }, latestSweep] = await Promise.all([
    supabase
      .from("kb_contradiction")
      .select(COLUMNS)
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    getLastSweptAt(),
  ]);
  if (error || !data) return [];

  const rows = data as unknown as ContradictionRow[];
  const geoNames = await resolveGeoNames(
    rows.map((row) => row.geo_code).filter((code): code is string => code !== null),
  );
  return rows.map((row) => ({
    ...toPending(row, geoNames, latestSweep),
    status: row.status,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  }));
}

export async function getContradictionCounts(): Promise<ContradictionCounts> {
  const supabase = createSupabaseServiceClient();
  const head = { count: "exact" as const, head: true };
  const lastSweptAt = await getLastSweptAt();

  const [pending, approved, rejected, stale] = await Promise.all([
    supabase.from("kb_contradiction").select("contradiction_id", head).eq("status", "auto"),
    supabase.from("kb_contradiction").select("contradiction_id", head).eq("status", "approved"),
    supabase.from("kb_contradiction").select("contradiction_id", head).eq("status", "rejected"),
    lastSweptAt
      ? supabase
          .from("kb_contradiction")
          .select("contradiction_id", head)
          .lt("last_swept_at", lastSweptAt)
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    pending: pending.count ?? 0,
    approved: approved.count ?? 0,
    rejected: rejected.count ?? 0,
    stale: stale.count ?? 0,
    lastSweptAt,
  };
}

/**
 * Records a judgement. The reviewer's identity comes from the admin session at the call site, never
 * from the form — `kb-review.ts`'s rule, for the same reason: a queue whose "who approved this"
 * field can be set by the request records nothing.
 */
export async function judgeContradiction(
  contradictionId: number,
  status: ReviewStatus,
  reviewer: string,
  note: string | null,
): Promise<{ error: string | null }> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("kb_contradiction")
    .update({
      status,
      review_note: note,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
    })
    .eq("contradiction_id", contradictionId);
  return { error: error?.message ?? null };
}

/** Returns a judged row to the queue, keeping the note that explains why it was judged. */
export async function reopenContradiction(
  contradictionId: number,
): Promise<{ error: string | null }> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("kb_contradiction")
    .update({ status: "auto", reviewed_by: null, reviewed_at: null })
    .eq("contradiction_id", contradictionId);
  return { error: error?.message ?? null };
}
