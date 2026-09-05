import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDistrictDetail, getDistrictDatasetGaps, getDistrictIndex } from "@/lib/db/districts";
import { districtOrdinalLabel } from "@/components/districts/district-ordinal";
import { DistrictMemberTable } from "@/components/districts/district-member-table";
import { SourceRefLink } from "@/components/districts/source-ref-link";
import { CorrectionForm } from "@/components/districts/correction-form";

export const revalidate = 3_600; // matches /districts — a snapshot rebuilt by ingestion

type DistrictParams = { districtCode: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<DistrictParams>;
}): Promise<Metadata> {
  const { districtCode } = await params;
  const detail = await getDistrictDetail(districtCode);
  if (!detail) return { title: "District not found" };
  return { title: detail.districtName };
}

export default async function DistrictDetailPage({
  params,
}: {
  params: Promise<DistrictParams>;
}) {
  const { districtCode } = await params;
  const [detail, datasetGaps, districtIndex] = await Promise.all([
    getDistrictDetail(districtCode),
    getDistrictDatasetGaps(),
    getDistrictIndex(),
  ]);

  if (!detail) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Link href="/districts" className="text-sm underline hover:text-accent">
          ← All districts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{detail.districtName}</h1>
        <p className="mt-1 text-sm text-muted">
          {districtOrdinalLabel(detail)}
          {detail.regionName ? ` · ${detail.regionName}` : ""} · Congress {detail.congressNo}
        </p>
        <p className="mt-2 max-w-3xl text-muted">
          This is the per-row receipt for how BHW Connect grouped {detail.districtName} — every
          member below carries the source page it was read from, the exact revision, and how it was
          matched. If a place here looks wrong, please{" "}
          <a href="#propose-correction" className="underline hover:text-accent">
            tell us
          </a>
          .
        </p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <div>
          <span className="font-semibold">{detail.members.length.toLocaleString()}</span>{" "}
          <span className="text-muted">member{detail.members.length === 1 ? "" : "s"}</span>
        </div>
        {detail.psaPopulation !== null && (
          <div>
            <span className="font-semibold">{detail.psaPopulation.toLocaleString()}</span>{" "}
            <span className="text-muted">PSA 2020 population</span>
          </div>
        )}
        {detail.representative && (
          <div>
            <span className="font-semibold">{detail.representative.fullName}</span>{" "}
            <span className="text-muted">
              {detail.representative.party ? `(${detail.representative.party}) ` : ""}
              representative as of{" "}
              {new Date(detail.representative.asOf).toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Members</h2>
        {detail.members.length === 0 ? (
          <p className="text-muted">
            This district has no membership rows loaded. See “Unresolved and disputed” below.
          </p>
        ) : (
          <DistrictMemberTable rows={detail.members} />
        )}
      </section>

      {detail.correctionHistory.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Correction history</h2>
          <p className="text-sm text-muted">
            Rows a correction has since superseded — kept rather than overwritten, so this is the
            audit trail for how the current membership was reached.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Match method</th>
                  <th className="px-4 py-3 font-medium">Source page &amp; revision</th>
                  <th className="px-4 py-3 font-medium">Reviewed</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {detail.correctionHistory.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 font-medium">{row.geoName}</td>
                    <td className="px-4 py-3 text-muted">{row.matchMethod}</td>
                    <td className="px-4 py-3">
                      <SourceRefLink sourceKind={row.sourceKind} sourceRef={row.sourceRef} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {row.reviewedAt
                        ? new Date(row.reviewedAt).toLocaleDateString("en-PH", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{row.reviewNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm">
        <h2 className="text-base font-semibold">Unresolved and disputed</h2>
        <p className="text-muted">
          Published rather than hidden, the same posture{" "}
          <Link href="/data-quality" className="underline hover:text-accent">
            /data-quality
          </Link>{" "}
          already takes: a missing assignment reads as a known finding, not a hidden one.
        </p>

        {detail.gapMembers.length > 0 ? (
          <div>
            <p className="font-medium text-danger">
              {detail.gapMembers.length} place{detail.gapMembers.length === 1 ? "" : "s"} belonging
              to this district could not be resolved from the source:
            </p>
            <ul className="mt-2 list-inside list-disc text-muted">
              {detail.gapMembers.map((m) => (
                <li key={m.geoCode}>{m.geoName}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted">
            No place has been positively identified as belonging to this district and left
            unresolved.
          </p>
        )}

        <p className="text-muted">
          Sitewide, as of the last build:{" "}
          {datasetGaps ? (
            <>
              <strong className="text-foreground">
                {datasetGaps.uncoveredCitymunCount.toLocaleString()}
              </strong>{" "}
              cities/municipalities have no district at all, and{" "}
              <strong className="text-foreground">
                {datasetGaps.unplacedBarangayCount.toLocaleString()}
              </strong>{" "}
              barangays inside multi-district cities are unplaced. Most of these gaps span several
              sibling districts and can&apos;t be pinned on any one of them from this data alone,
              which is why they aren&apos;t listed by name here.
            </>
          ) : (
            "figures are temporarily unavailable."
          )}{" "}
          There are also members named in a source page that this build could not match to any
          place, or that two sources disagree about — not attributable to a district at all, so not
          shown here.{" "}
          <a
            href="https://github.com/jongsky25/bhw-connect-dashboard/blob/main/docs/LEGISLATIVE_DISTRICTS.md"
            className="underline hover:text-accent"
            target="_blank"
            rel="noopener noreferrer"
          >
            Full build report, every known gap by name
          </a>
          .
        </p>
      </section>

      <section
        id="propose-correction"
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <h2 className="text-base font-semibold">Propose a correction</h2>
        <p className="text-sm text-muted">
          A structured proposal, not a message — it is reviewed against the source above and, once
          accepted, supersedes the row it corrects rather than overwriting it (the correction
          history section above is where that history shows up). Every proposal is then published
          on the{" "}
          <Link href="/districts/corrections" className="underline hover:text-accent">
            correction ledger
          </Link>{" "}
          with the reason it was accepted or not — including the ones that weren&apos;t.
        </p>
        <CorrectionForm
          districtCode={detail.districtCode}
          districtName={detail.districtName}
          members={detail.members.map((m) => ({ geoCode: m.geoCode, geoName: m.geoName }))}
          districtOptions={districtIndex.map((d) => ({ code: d.districtCode, name: d.districtName }))}
        />
      </section>
    </div>
  );
}
