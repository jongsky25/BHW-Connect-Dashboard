import Link from "next/link";
import { getPublicDistrictCorrectionLedger, PUBLIC_LEDGER_LIMIT } from "@/lib/db/district-corrections";
import { CorrectionLedger } from "@/components/districts/correction-ledger";

export const metadata = {
  title: "District corrections",
  description:
    "Every correction proposed to BHW Connect's legislative-district mapping, with its status and the reason it was accepted or not.",
};

/**
 * D2.5 — the public ledger (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5): every proposal ever submitted,
 * its status, and its review note.
 *
 * This is the page that makes the correction mechanism credible rather than decorative. A
 * submission box with no visible disposition trains people to stop submitting — the mapping is
 * single-source (Wikipedia/Wikidata; the intended second opinion, COMELEC's precinct returns, is
 * no longer reachable), and public corrections are the second source it is missing. Losing them to
 * an invisible queue is the failure mode with the highest cost here.
 *
 * The read is server-side and column-projected on purpose. `district_correction` has no public
 * SELECT policy: `submitter_email` sits on the table, and a policy broad enough to serve this page
 * would serve anyone who wants that column too (docs/DECISIONS.md, 2026-09-02). See
 * `PUBLIC_CORRECTION_COLUMNS` for what is published and what is deliberately not.
 *
 * The one-hour window matches `/districts` and `/districts/[districtCode]`, but neither a new
 * submission nor a review waits it out: the submission route and the admin's judge action both
 * revalidate this path, so the ledger reflects a proposal within seconds of it existing.
 */
export const revalidate = 3_600;

export default async function DistrictCorrectionsPage() {
  const { corrections, counts, truncated } = await getPublicDistrictCorrectionLedger();
  const total = counts.pending + counts.accepted + counts.rejected + counts.duplicate;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Link href="/districts" className="text-sm underline hover:text-accent">
          ← All districts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">District corrections</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Every correction anyone has proposed to this district mapping, whether it was accepted or
          not, with the reason. The mapping is{" "}
          <Link href="/districts" className="underline hover:text-accent">
            derived from public sources rather than published by PSA or COMELEC
          </Link>
          , so a reader who knows their own city, municipality, or barangay is the second source it
          doesn&apos;t otherwise have. This page is the receipt for what happens to what they send.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <Count value={total} label={`proposal${total === 1 ? "" : "s"} received`} />
        <Count value={counts.pending} label="awaiting review" />
        <Count value={counts.accepted} label="accepted, mapping updated" />
        <Count value={counts.rejected} label="not accepted, with a reason" />
        <Count value={counts.duplicate} label="already reported by someone else" />
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-border p-4 text-muted">
          No correction has been proposed yet. When one is, it appears here — accepted or not —
          along with the reviewer&apos;s reasoning.
        </p>
      ) : (
        <>
          {truncated && (
            <p className="text-sm text-muted">
              Showing the {PUBLIC_LEDGER_LIMIT.toLocaleString()} most recent proposals. The counts
              above cover all {total.toLocaleString()}.
            </p>
          )}
          <CorrectionLedger corrections={corrections} />
        </>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
        <h2 className="text-base font-semibold">What is published here, and what is not</h2>
        <p className="text-muted">
          The proposal text and the review note are published in full, verbatim, as the correction
          form says before you submit. A rejection whose reason nobody can read is
          indistinguishable from being ignored, so the note is required of the reviewer for every
          outcome — including acceptance.
        </p>
        <p className="text-muted">
          A submitter&apos;s email address is <strong className="text-foreground">never</strong>{" "}
          published. It is optional on the form, used only to ask a follow-up question, and this
          page never reads that column. Neither is the reviewer&apos;s identity published: the
          reasoning is the accountable part, and it is here in full.
        </p>
        <p className="text-muted">
          Nothing is overwritten when a correction is accepted. A row that a correction supersedes
          stays in the &ldquo;Correction history&rdquo; section of the district&apos;s own page
          rather than disappearing, so the mapping&apos;s current state and how it got there are
          both readable.
        </p>
        <p className="text-muted">
          To propose one, open the district you know is wrong from{" "}
          <Link href="/districts" className="underline hover:text-accent">
            the district index
          </Link>{" "}
          and use the &ldquo;Propose a correction&rdquo; form at the bottom of its page — a
          proposal is tied to a specific district and place, which is what makes it reviewable
          against the source rather than a message to triage.
        </p>
      </section>
    </div>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <span className="font-semibold">{value.toLocaleString()}</span>{" "}
      <span className="text-muted">{label}</span>
    </div>
  );
}
