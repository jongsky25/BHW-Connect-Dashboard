import "server-only";
import { publishAcceptedCorrection } from "@/lib/db/district-correction-changelog";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Read and write layer for D2.4's admin review queue (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5),
 * modelled on `lib/db/kb-review.ts`: service-role only, reads degrade to empty rather than
 * throwing, writes return their error text rather than swallowing it.
 *
 * THREE OUTCOMES, EACH A DIFFERENT SHAPE OF WRITE. `duplicate` and `rejected` only close the
 * `district_correction` row. `accepted` also has to make the mapping say what the submitter
 * proposed — and what that means differs by `action`:
 *
 *   - **add**: insert a new live `geo_district_map` row. Nothing existed to supersede.
 *   - **remove**: mark the existing live row `status = 'rejected'`. That is enough on its own —
 *     `geo_district_map`'s public-read policy (`status <> 'rejected'`) drops it from every public
 *     query the moment this writes, live membership and correction history alike. No tombstone
 *     row is needed, and inventing one would create a second live-looking row for nothing.
 *   - **move**: insert the new row in the destination district, then point the old row's
 *     `superseded_by` at it — the ordinary supersession the schema was built for (plan §3:
 *     "corrections supersede; nothing is overwritten"), so the old row keeps rendering in D2.2's
 *     correction-history section rather than disappearing.
 *   - **rename**: a plain `dim_legislative_district.district_name` update. No `geo_district_map`
 *     row is involved, which is why this is the one action taking `newDistrictName` — the
 *     structured form (D2.3) never asked the submitter for a replacement name, so the admin
 *     supplies it at accept time, the same way `kb-review`'s `editNode` lets a reviewer fix
 *     wording before approving.
 *   - **other**: no automatic mutation. The review note is the record of whatever, if anything,
 *     was done by hand.
 *
 * There is deliberately no roll-up trigger here: §6.1's district aggregates (Phase D3, not yet
 * built) are computed live by DB functions rather than materialized, so the 1-hour ISR window
 * `/districts` and `/districts/[districtCode]` already use is what "rebuilds" them. `judge`
 * revalidates both paths so an accepted correction does not wait out that hour.
 */

export type DistrictCorrectionAction = "add" | "remove" | "move" | "rename" | "other";
export type DistrictCorrectionDecision = "accepted" | "rejected" | "duplicate";

export function isDistrictCorrectionDecision(value: unknown): value is DistrictCorrectionDecision {
  return value === "accepted" || value === "rejected" || value === "duplicate";
}

type CorrectionFields = {
  id: number;
  createdAt: string;
  action: DistrictCorrectionAction;
  districtCode: string | null;
  districtName: string | null;
  toDistrictCode: string | null;
  toDistrictName: string | null;
  geoCode: string | null;
  geoName: string | null;
  rationale: string;
  evidenceUrl: string | null;
  submitterEmail: string | null;
};

export type PendingDistrictCorrection = CorrectionFields;

export type JudgedDistrictCorrection = CorrectionFields & {
  status: DistrictCorrectionDecision;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
};

export type DistrictCorrectionCounts = {
  pending: number;
  accepted: number;
  rejected: number;
  duplicate: number;
};

type RawCorrectionRow = {
  id: number;
  created_at: string;
  action: string;
  district_code: string | null;
  to_district_code: string | null;
  geo_code: string | null;
  rationale: string;
  evidence_url: string | null;
  submitter_email: string | null;
};

/** Anything carrying the three codes that need a display name — a correction row, or one of the
 *  `geo_district_map` rows an accepted correction produced (D2.5). */
type CodeBearingRow = {
  district_code?: string | null;
  to_district_code?: string | null;
  geo_code?: string | null;
};

/** District and geo names for a batch of correction rows, one round trip each rather than one per
 *  row — the queue reads a handful of rows at a time, never a whole table. */
async function nameLookups(rows: CodeBearingRow[]) {
  const supabase = createSupabaseServiceClient();
  const districtCodes = Array.from(
    new Set(rows.flatMap((r) => [r.district_code, r.to_district_code]).filter((c): c is string => Boolean(c))),
  );
  const geoCodes = Array.from(new Set(rows.map((r) => r.geo_code).filter((c): c is string => Boolean(c))));

  const [districtRows, geoRows] = await Promise.all([
    districtCodes.length
      ? supabase.from("dim_legislative_district").select("district_code, district_name").in("district_code", districtCodes)
      : Promise.resolve({ data: [] as { district_code: string; district_name: string }[] }),
    geoCodes.length
      ? supabase.from("dim_geo").select("geo_code, geo_name").in("geo_code", geoCodes)
      : Promise.resolve({ data: [] as { geo_code: string; geo_name: string }[] }),
  ]);

  return {
    districtName: new Map((districtRows.data ?? []).map((d) => [d.district_code, d.district_name])),
    geoName: new Map((geoRows.data ?? []).map((g) => [g.geo_code, g.geo_name])),
  };
}

function toFields(
  row: RawCorrectionRow,
  names: { districtName: Map<string, string>; geoName: Map<string, string> },
): CorrectionFields {
  return {
    id: row.id,
    createdAt: row.created_at,
    action: row.action as DistrictCorrectionAction,
    districtCode: row.district_code,
    districtName: row.district_code ? (names.districtName.get(row.district_code) ?? null) : null,
    toDistrictCode: row.to_district_code,
    toDistrictName: row.to_district_code ? (names.districtName.get(row.to_district_code) ?? null) : null,
    geoCode: row.geo_code,
    geoName: row.geo_code ? (names.geoName.get(row.geo_code) ?? null) : null,
    rationale: row.rationale,
    evidenceUrl: row.evidence_url,
    submitterEmail: row.submitter_email,
  };
}

const CORRECTION_COLUMNS =
  "id, created_at, action, district_code, to_district_code, geo_code, rationale, evidence_url, submitter_email";

export async function listPendingDistrictCorrections(): Promise<PendingDistrictCorrection[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("district_correction")
    .select(CORRECTION_COLUMNS)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error || !data) return [];

  const names = await nameLookups(data);
  return data.map((row) => toFields(row, names));
}

export async function listRecentlyJudgedDistrictCorrections(limit = 20): Promise<JudgedDistrictCorrection[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("district_correction")
    .select(`${CORRECTION_COLUMNS}, status, reviewed_at, reviewed_by, review_note`)
    .neq("status", "open")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) return [];

  const names = await nameLookups(data);
  return data.map((row) => ({
    ...toFields(row, names),
    status: row.status as DistrictCorrectionDecision,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewNote: row.review_note,
  }));
}

/* -------------------------------------------------------------------------- */
/* D2.5 — the public ledger                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every column `/districts/corrections` publishes, and **only** those. Two columns of
 * `district_correction` are deliberately not here:
 *
 *   - `submitter_email`, which the form promises is never published. This is the constraint the
 *     migration handed D2.5 (20260902030000_legislative_districts.sql, and docs/DECISIONS.md
 *     2026-09-02): the table has no public SELECT policy precisely because a policy broad enough
 *     to serve this page would also serve anyone who wants the email column. Projecting the
 *     columns server-side is the fix; relaxing the policy is not.
 *   - `reviewed_by`, an admin's email or user id. The plan asks the ledger to publish the review
 *     *note* — the reasoning — not the reviewer's identity, and publishing an admin's address to
 *     satisfy a transparency promise made about submitters' addresses would be an odd trade.
 *
 * `session_id` is likewise absent: it is a spam-defence handle, not a fact about the proposal.
 *
 * Keeping the list as a named constant rather than inline is what lets a test assert the negative
 * — that no query behind the public page ever asks for those columns.
 */
export const PUBLIC_CORRECTION_COLUMNS =
  "id, created_at, action, district_code, to_district_code, geo_code, rationale, evidence_url, status, reviewed_at, review_note";

/** Newest-first cap on one ledger render. The table holds a handful of rows today and would have
 *  to grow ~100× before this bites; the summary counts above the list are exact regardless, so a
 *  truncated list under-reports the rows shown and never the totals. */
export const PUBLIC_LEDGER_LIMIT = 500;

/** `open` is a status on the ledger the way the three decisions are: a proposal nobody has judged
 *  yet is exactly what a reader checking whether their submission went anywhere needs to see. */
export type PublicDistrictCorrectionStatus = "open" | DistrictCorrectionDecision;

/** A `geo_district_map` row an accepted correction created, and the district page it now shows on
 *  — "the row it changed", made a link rather than a claim. */
export type CorrectionOutcomeRow = {
  id: number;
  districtCode: string;
  districtName: string | null;
  geoCode: string;
  geoName: string | null;
};

export type PublicDistrictCorrection = {
  id: number;
  createdAt: string;
  action: DistrictCorrectionAction;
  districtCode: string | null;
  districtName: string | null;
  toDistrictCode: string | null;
  toDistrictName: string | null;
  geoCode: string | null;
  geoName: string | null;
  rationale: string;
  evidenceUrl: string | null;
  status: PublicDistrictCorrectionStatus;
  reviewedAt: string | null;
  reviewNote: string | null;
  outcomeRows: CorrectionOutcomeRow[];
};

export type PublicDistrictCorrectionLedger = {
  corrections: PublicDistrictCorrection[];
  counts: DistrictCorrectionCounts;
  /** True when there are more proposals than `PUBLIC_LEDGER_LIMIT`, so the page can say so rather
   *  than quietly showing a prefix of a list it promised was complete. */
  truncated: boolean;
};

type RawPublicCorrectionRow = {
  id: number;
  created_at: string;
  action: string;
  district_code: string | null;
  to_district_code: string | null;
  geo_code: string | null;
  rationale: string;
  evidence_url: string | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
};

type RawOutcomeRow = {
  id: number;
  district_code: string;
  geo_code: string;
  source_ref: string | null;
};

function toPublicStatus(status: string): PublicDistrictCorrectionStatus {
  return isDistrictCorrectionDecision(status) ? status : "open";
}

/**
 * The `geo_district_map` rows accepted corrections wrote, keyed by the correction that wrote them
 * — matched on the `source_ref` `applyAcceptance` stamps (`district_correction:<id>`), which is the
 * only link between the two tables and the reason that stamp exists.
 *
 * Only `add` and `move` produce such a row. An accepted `remove` marks the existing row rejected
 * (no new row, and the rejected one is invisible to public reads by policy), a `rename` touches
 * `dim_legislative_district` instead, and `other` writes nothing at all — so the absence of an
 * outcome row here is normal, not a failure, and the page says what changed in words for those.
 */
async function outcomeRowsByCorrection(
  ids: number[],
): Promise<{ rows: Map<number, RawOutcomeRow[]>; all: RawOutcomeRow[] }> {
  const empty = { rows: new Map<number, RawOutcomeRow[]>(), all: [] as RawOutcomeRow[] };
  if (ids.length === 0) return empty;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("geo_district_map")
    .select("id, district_code, geo_code, source_ref")
    .in(
      "source_ref",
      ids.map((id) => `district_correction:${id}`),
    );
  if (error || !data) return empty;

  const rows = new Map<number, RawOutcomeRow[]>();
  for (const row of data as RawOutcomeRow[]) {
    const id = Number(row.source_ref?.slice("district_correction:".length));
    if (!Number.isInteger(id)) continue;
    const bucket = rows.get(id);
    if (bucket) bucket.push(row);
    else rows.set(id, [row]);
  }
  return { rows, all: data as RawOutcomeRow[] };
}

/**
 * D2.5 — every proposal ever submitted, with its status, its review note, and (for the accepted
 * ones) the mapping rows it produced. Read with the service client and projected here rather than
 * served from the client, because `district_correction` has no public SELECT policy by design.
 *
 * Degrades to an empty ledger rather than throwing, like every other read in this module: a page
 * whose point is "the correction mechanism is not a black box" is better rendering an empty list
 * with its explanation intact than a 500.
 */
export async function getPublicDistrictCorrectionLedger(): Promise<PublicDistrictCorrectionLedger> {
  const counts = await getDistrictCorrectionCounts();
  const empty: PublicDistrictCorrectionLedger = { corrections: [], counts, truncated: false };

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("district_correction")
      .select(PUBLIC_CORRECTION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(PUBLIC_LEDGER_LIMIT);
    if (error || !data) return empty;

    const rows = data as RawPublicCorrectionRow[];
    const accepted = rows.filter((r) => r.status === "accepted").map((r) => r.id);
    const outcomes = await outcomeRowsByCorrection(accepted);
    // One name lookup over the proposals and their outcome rows together — the outcome of a `move`
    // names a district the proposal itself does not.
    const names = await nameLookups([...rows, ...outcomes.all]);

    const corrections = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action as DistrictCorrectionAction,
      districtCode: row.district_code,
      districtName: row.district_code ? (names.districtName.get(row.district_code) ?? null) : null,
      toDistrictCode: row.to_district_code,
      toDistrictName: row.to_district_code ? (names.districtName.get(row.to_district_code) ?? null) : null,
      geoCode: row.geo_code,
      geoName: row.geo_code ? (names.geoName.get(row.geo_code) ?? null) : null,
      rationale: row.rationale,
      evidenceUrl: row.evidence_url,
      status: toPublicStatus(row.status),
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      outcomeRows: (outcomes.rows.get(row.id) ?? []).map((o) => ({
        id: o.id,
        districtCode: o.district_code,
        districtName: names.districtName.get(o.district_code) ?? null,
        geoCode: o.geo_code,
        geoName: names.geoName.get(o.geo_code) ?? null,
      })),
    }));

    const total = counts.pending + counts.accepted + counts.rejected + counts.duplicate;
    return { corrections, counts, truncated: total > corrections.length };
  } catch {
    return empty;
  }
}

export async function getDistrictCorrectionCounts(): Promise<DistrictCorrectionCounts> {
  const zero: DistrictCorrectionCounts = { pending: 0, accepted: 0, rejected: 0, duplicate: 0 };
  try {
    const supabase = createSupabaseServiceClient();
    const head = { count: "exact" as const, head: true };
    const [pending, accepted, rejected, duplicate] = await Promise.all([
      supabase.from("district_correction").select("id", head).eq("status", "open"),
      supabase.from("district_correction").select("id", head).eq("status", "accepted"),
      supabase.from("district_correction").select("id", head).eq("status", "rejected"),
      supabase.from("district_correction").select("id", head).eq("status", "duplicate"),
    ]);
    return {
      pending: pending.count ?? 0,
      accepted: accepted.count ?? 0,
      rejected: rejected.count ?? 0,
      duplicate: duplicate.count ?? 0,
    };
  } catch {
    return zero;
  }
}

/** The live `geo_district_map` row for one (district, geo) pair, if any — the row a 'remove' marks
 *  rejected, or the row a 'move' supersedes. */
async function findLiveMember(districtCode: string, geoCode: string) {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("geo_district_map")
    .select("id, geo_level")
    .eq("district_code", districtCode)
    .eq("geo_code", geoCode)
    .is("superseded_by", null)
    .maybeSingle();
  return data;
}

/** `dim_geo.geo_level` for a geo_code the submitter picked freely (the 'add' typeahead is not
 *  bounded to a district's own membership the way 'remove'/'move' are — see `CorrectionForm`). */
async function geoLevelFor(geoCode: string): Promise<"citymun" | "barangay" | null> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase.from("dim_geo").select("geo_level").eq("geo_code", geoCode).maybeSingle();
  if (!data || (data.geo_level !== "citymun" && data.geo_level !== "barangay")) return null;
  return data.geo_level;
}

/** Applies an accepted correction's effect. Returns an error string on failure, `null` on success
 *  — including the no-op success of 'other', which never had a mutation to apply. */
async function applyAcceptance(
  correction: RawCorrectionRow,
  reviewedBy: string,
  note: string | null,
  newDistrictName: string | null,
): Promise<string | null> {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const sourceRef = `district_correction:${correction.id}`;

  switch (correction.action) {
    case "add": {
      if (!correction.district_code || !correction.geo_code) return "Missing the place or district";
      const geoLevel = await geoLevelFor(correction.geo_code);
      if (!geoLevel) return "That place could not be resolved to a city/municipality or barangay";
      const { error } = await supabase.from("geo_district_map").insert({
        district_code: correction.district_code,
        geo_code: correction.geo_code,
        geo_level: geoLevel,
        match_method: "public_correction",
        source_kind: "public_correction",
        source_ref: sourceRef,
        retrieved_at: now,
        status: "approved",
        reviewed_at: now,
        reviewed_by: reviewedBy,
        review_note: note,
      });
      return error ? error.message : null;
    }

    case "remove": {
      if (!correction.district_code || !correction.geo_code) return "Missing the place or district";
      const { data, error } = await supabase
        .from("geo_district_map")
        .update({ status: "rejected", reviewed_at: now, reviewed_by: reviewedBy, review_note: note })
        .eq("district_code", correction.district_code)
        .eq("geo_code", correction.geo_code)
        .is("superseded_by", null)
        .select("id");
      if (error) return error.message;
      if (!data || data.length === 0) return "No live membership row matches this place and district";
      return null;
    }

    case "move": {
      if (!correction.district_code || !correction.geo_code || !correction.to_district_code) {
        return "Missing the place, its current district, or its destination district";
      }
      const existing = await findLiveMember(correction.district_code, correction.geo_code);
      const geoLevel = existing?.geo_level ?? (await geoLevelFor(correction.geo_code));
      if (!geoLevel) return "That place could not be resolved to a city/municipality or barangay";

      const { data: inserted, error: insertError } = await supabase
        .from("geo_district_map")
        .insert({
          district_code: correction.to_district_code,
          geo_code: correction.geo_code,
          geo_level: geoLevel,
          match_method: "public_correction",
          source_kind: "public_correction",
          source_ref: sourceRef,
          retrieved_at: now,
          status: "approved",
          reviewed_at: now,
          reviewed_by: reviewedBy,
          review_note: note,
        })
        .select("id")
        .single();
      if (insertError || !inserted) return insertError?.message ?? "Could not record the new membership";

      if (existing) {
        const { error: supersedeError } = await supabase
          .from("geo_district_map")
          .update({ superseded_by: inserted.id })
          .eq("id", existing.id);
        if (supersedeError) return supersedeError.message;
      }
      return null;
    }

    case "rename": {
      if (!correction.district_code) return "Missing which district to rename";
      const name = newDistrictName?.trim();
      if (!name) return "A new district name is required to accept a rename";
      const { error } = await supabase
        .from("dim_legislative_district")
        .update({ district_name: name })
        .eq("district_code", correction.district_code);
      return error ? error.message : null;
    }

    case "other":
      return null;

    default:
      return `Unknown correction action: ${correction.action}`;
  }
}

/**
 * Judges one open `district_correction` row. Refuses a row that is not currently `open` — there is
 * no "return to review" here (unlike `kb-review`'s nodes/edges): reversing an accepted correction's
 * `geo_district_map` writes is not a simple status flip, and the plan does not ask for one.
 *
 * On `accepted`, the mapping mutation runs first; the `district_correction` row is only closed out
 * if that mutation succeeds, so a failed accept leaves the proposal open for the admin to retry
 * rather than recording an acceptance that changed nothing.
 *
 * D2.6 adds a third step after both: `publishAcceptedCorrection` writes the changelog entry and
 * bumps the district dataset's version. It runs last and cannot fail the judgement — see that
 * module for why a record of a change that already happened must not be able to reverse it.
 */
export async function judgeDistrictCorrection(
  id: number,
  decision: DistrictCorrectionDecision,
  reviewedBy: string,
  note: string | null,
  newDistrictName: string | null,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data: correction, error: fetchError } = await supabase
      .from("district_correction")
      .select(`${CORRECTION_COLUMNS}, status`)
      .eq("id", id)
      .maybeSingle();
    if (fetchError) return fetchError.message;
    if (!correction) return "Correction not found";
    if (correction.status !== "open") return "This correction has already been judged";

    // Read the names *before* applying anything. An accepted `rename` overwrites
    // `dim_legislative_district.district_name`, so a lookup afterwards would print the new name as
    // the old one too and the changelog line would say a district was renamed to what it already
    // was called. Only on the accept path: the other two outcomes publish nothing.
    const names = decision === "accepted" ? await nameLookups([correction]) : null;

    if (decision === "accepted") {
      const mutationError = await applyAcceptance(correction, reviewedBy, note, newDistrictName);
      if (mutationError) return mutationError;
    }

    const { error } = await supabase
      .from("district_correction")
      .update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy,
        review_note: note,
      })
      .eq("id", id);
    if (error) return error.message;

    if (decision === "accepted" && names) {
      const fields = toFields(correction, names);
      await publishAcceptedCorrection({
        id: fields.id,
        action: fields.action,
        districtCode: fields.districtCode,
        districtName: fields.districtName,
        toDistrictCode: fields.toDistrictCode,
        toDistrictName: fields.toDistrictName,
        geoCode: fields.geoCode,
        geoName: fields.geoName,
        newDistrictName,
      });
    }
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}
