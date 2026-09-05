import Link from "next/link";
import {
  getDistrictCorrectionCounts,
  listPendingDistrictCorrections,
  listRecentlyJudgedDistrictCorrections,
  type JudgedDistrictCorrection,
  type PendingDistrictCorrection,
} from "@/lib/db/district-corrections";
import {
  CORRECTION_ACTION_LABEL,
  describeCorrectionChange,
} from "@/components/districts/correction-change";
import { judgeCorrection } from "./actions";

/**
 * D2.4 — the admin review queue for D2.3's structured proposals, modelled on `kb-review`: the
 * proposal is the evidence, shown on the card rather than behind a link, and a reviewer picks one
 * of three outcomes rather than editing a record directly.
 *
 * Accept / reject / duplicate rather than kb-review's approve/reject, because a fourth thing can
 * happen to a public submission that never happens to a model's extraction: two people report the
 * same gap. `duplicate` records that without pretending the second report was wrong.
 */
export default async function AdminDistrictCorrectionsPage() {
  const [pending, judged, counts] = await Promise.all([
    listPendingDistrictCorrections(),
    listRecentlyJudgedDistrictCorrections(),
    getDistrictCorrectionCounts(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">District corrections</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Awaiting review" value={counts.pending} hint="submitted publicly" />
          <Stat label="Accepted" value={counts.accepted} hint="mapping updated" />
          <Stat label="Rejected" value={counts.rejected} hint="kept, with a reason" />
          <Stat label="Duplicate" value={counts.duplicate} hint="already reported" />
        </div>
        <p className="text-xs text-muted">
          Each of these came from a reader&apos;s{" "}
          <span className="font-medium">&ldquo;Propose a correction&rdquo;</span> form on a
          district&apos;s own page (D2.3) — structured, not free text, so it is diffable against the
          current mapping. Accepting writes a new <span className="font-mono">geo_district_map</span>{" "}
          row (or, for a rename, updates the district name directly) and closes the proposal; the
          review note is published on the correction&apos;s own record and is mandatory for every
          outcome, including acceptance.
        </p>
        <p className="text-xs text-muted">
          Write the note for the submitter, not for this screen: it is published verbatim, next to
          the proposal it judges, on the public{" "}
          <Link
            href="/districts/corrections"
            target="_blank"
            rel="noopener"
            className="underline hover:text-accent"
          >
            correction ledger
          </Link>{" "}
          (D2.5). Your own identity is not — the reasoning is what gets published, not who wrote
          it.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Awaiting review ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing awaiting review.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((row) => (
              <CorrectionCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Recently judged</h3>
        {judged.length === 0 ? (
          <p className="text-sm text-muted">Nothing judged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {judged.map((row) => (
              <JudgedCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function CorrectionCard({ row }: { row: PendingDistrictCorrection }) {
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
          {CORRECTION_ACTION_LABEL[row.action]}
        </span>
        <span className="text-sm font-medium">{describeCorrectionChange(row)}</span>
        <span className="text-xs text-muted">{new Date(row.createdAt).toLocaleDateString()}</span>
      </div>

      <div className="mt-2 rounded-md border border-border bg-surface p-3">
        <p className="text-sm">{row.rationale}</p>
        {row.evidenceUrl && (
          <p className="mt-1 text-xs">
            <a href={row.evidenceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">
              {row.evidenceUrl}
            </a>
          </p>
        )}
        {row.submitterEmail && (
          <p className="mt-1 text-xs text-muted">Contact (never published): {row.submitterEmail}</p>
        )}
      </div>

      <form action={judgeCorrection} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="correctionId" value={row.id} />
        <input type="hidden" name="districtCode" value={row.districtCode ?? ""} />
        <input type="hidden" name="toDistrictCode" value={row.toDistrictCode ?? ""} />

        {row.action === "rename" && (
          <input
            type="text"
            name="newDistrictName"
            maxLength={200}
            placeholder="Correct district name (required to accept a rename)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="note"
            required
            maxLength={500}
            placeholder="Review note (required for every outcome — published on the proposal's record)"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          />
          <button
            type="submit"
            name="decision"
            value="accepted"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            Accept
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-danger hover:bg-surface"
          >
            Reject
          </button>
          <button
            type="submit"
            name="decision"
            value="duplicate"
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface"
          >
            Duplicate
          </button>
        </div>
      </form>
    </li>
  );
}

const STATUS_LABEL: Record<JudgedDistrictCorrection["status"], string> = {
  accepted: "accepted",
  rejected: "rejected",
  duplicate: "duplicate",
};

function JudgedCard({ row }: { row: JudgedDistrictCorrection }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span
        className={
          row.status === "accepted"
            ? "rounded-full bg-accent-subtle px-2 py-0.5 text-xs text-accent"
            : "rounded-full bg-surface px-2 py-0.5 text-xs text-danger"
        }
      >
        {STATUS_LABEL[row.status]}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{describeCorrectionChange(row)}</span>
      <span className="text-xs text-muted">
        {row.reviewedBy ?? "unrecorded"}
        {row.reviewedAt ? ` · ${row.reviewedAt.slice(0, 10)}` : ""}
        {row.reviewNote ? ` · ${row.reviewNote}` : ""}
      </span>
    </li>
  );
}
