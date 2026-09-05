import "server-only";
import {
  describeAcceptedOutcome,
  describeCorrectionChange,
  type CorrectionChange,
} from "@/components/districts/correction-change";
import { DATASET_SLUGS } from "./dataset";
import { bumpDatasetVersion } from "./dataset-version";
import { createSupabaseServiceClient } from "./service-client";

/**
 * D2.6 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5): what an accepted correction publishes about itself,
 * beyond the mapping row it wrote. Two writes, and the reason each exists is different:
 *
 *   - **A `changelog_entries` row.** `/districts/corrections` already publishes every proposal, but
 *     only to a reader who went looking for the correction ledger. `/methodology`'s changelog is
 *     where this site records that a published figure changed — and a mapping correction is exactly
 *     that, arriving from outside rather than from an ingestion run. Without it the only surface
 *     saying the data moved is the one page whose audience already knew.
 *   - **A `dim_dataset.last_updated_at` bump** for `ph-legislative-districts`, which is the version
 *     string every per-dataset cache in this repo keys on. See the note on `publishAcceptedCorrection`
 *     for what that does and does not invalidate today.
 *
 * **Both are best-effort and neither can undo the mapping write.** By the time this runs, the
 * `geo_district_map` row exists and the proposal is closed. A failure here is a missing record of a
 * change that really happened, which is bad; failing the acceptance back to the admin after the
 * mapping already moved would be worse, because the retry path re-applies the mutation.
 */

/** One accepted proposal, resolved to names, as the changelog needs it. Names are read *before* the
 *  acceptance is applied — a `rename` overwrites `dim_legislative_district.district_name`, so a
 *  lookup afterwards would print the new name on both sides of "renamed to". */
export type AcceptedCorrection = CorrectionChange & {
  id: number;
  /** The name a `rename` supplied at accept time; null for every other action. */
  newDistrictName: string | null;
};

export type ChangelogDraft = { title: string; bodyMd: string };

/**
 * The changelog entry text for one accepted correction. Pure, so the wording is testable without a
 * database — and separate from the writer, because the wording is the part that carries the
 * promises.
 *
 * **The one-line description is `describeCorrectionChange`'s, not a third paraphrase.** The queue
 * and the ledger already share it (docs/DECISIONS.md, 2026-09-05) for the reason that applies here
 * too: a reader who followed a changelog line to the ledger should meet the same sentence, not a
 * rewording they have to reconcile.
 *
 * **`body_md` is written as plain prose despite its name.** `/methodology` renders it inside a
 * `<p>`, verbatim — markdown syntax would show as literal syntax, and a link would not be a link.
 * The path is named in words for the same reason.
 *
 * **The submitter's own text is deliberately not copied here.** The rationale is public and the
 * ledger publishes it in full; that is a page about proposals, where unmoderated text is the point.
 * `/methodology` is not, and republishing it there would put an open form's output on a page nobody
 * reviews entry by entry. The changelog says what the mapping now says and where to read why.
 */
export function draftAcceptedCorrectionChangelog(correction: AcceptedCorrection): ChangelogDraft {
  const renamed =
    correction.action === "rename" && correction.newDistrictName
      ? ` The district is now named "${correction.newDistrictName}".`
      : "";

  return {
    title: `Legislative districts: ${describeCorrectionChange(correction)}`,
    bodyMd:
      `Public correction #${correction.id} was accepted on review. ` +
      `${describeAcceptedOutcome(correction.action)}${renamed} ` +
      "The proposal in the submitter's own words, the evidence it cited and the reviewer's note are " +
      "published in full on the correction ledger at /districts/corrections. " +
      "This mapping is derived from public sources and is not published by PSA or COMELEC: a " +
      "correction changes what this site publishes, not any official record.",
  };
}

export type PublicationOutcome = {
  changelogWritten: boolean;
  versionBumped: boolean;
  /** Why either write failed, for the server log. Empty when both succeeded. */
  failures: string[];
};

/**
 * Records an accepted correction on the changelog and bumps the district dataset's version.
 *
 * **What the bump invalidates today, stated plainly.** `lib/ai/dataset-scope.ts` currently defines
 * two scopes, `bhw` and `uuc-phc`; neither is keyed on `ph-legislative-districts`, so there are no
 * district answers in `ai_ask_cache` for this to expire yet. The plan's §6.4 claim ("cache
 * versioning is already free") is about the mechanism, and this is the half of it that has to exist
 * before D3.4 adds the scope — writing it now means the district scope arrives already correct
 * rather than arriving and quietly serving pre-correction answers. What the bump does do today is
 * make `dim_dataset.last_updated_at` an honest answer to "when did this mapping last change",
 * which it was not while only a re-seeding migration could move it.
 */
export async function publishAcceptedCorrection(
  correction: AcceptedCorrection,
): Promise<PublicationOutcome> {
  const failures: string[] = [];

  const { title, bodyMd } = draftAcceptedCorrectionChangelog(correction);
  let changelogWritten = false;
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("changelog_entries").insert({ title, body_md: bodyMd });
    if (error) failures.push(`changelog entry: ${error.message}`);
    else changelogWritten = true;
  } catch (cause) {
    failures.push(`changelog entry: ${cause instanceof Error ? cause.message : "write failed"}`);
  }

  const bumpError = await bumpDatasetVersion(DATASET_SLUGS.legislativeDistricts);
  if (bumpError) failures.push(`dataset version: ${bumpError}`);

  // Logged rather than returned to the caller as an error: the acceptance itself has already
  // succeeded and must not be re-run, so the only useful place for this is the server log.
  if (failures.length > 0) {
    console.error(`[districts] correction #${correction.id} accepted but not fully published:`, failures);
  }

  return { changelogWritten, versionBumped: bumpError === null, failures };
}
