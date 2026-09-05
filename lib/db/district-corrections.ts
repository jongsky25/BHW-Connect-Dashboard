import "server-only";
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

/** District and geo names for a batch of correction rows, one round trip each rather than one per
 *  row — the queue reads a handful of rows at a time, never a whole table. */
async function nameLookups(rows: RawCorrectionRow[]) {
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
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}
