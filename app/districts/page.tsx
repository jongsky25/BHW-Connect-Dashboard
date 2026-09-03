import { getDistrictIndex } from "@/lib/db/districts";
import { DistrictIndexTable } from "@/components/districts/district-index-table";
import { MatchQualityBadge, MATCH_QUALITY_DESCRIPTION } from "@/components/districts/match-quality-badge";
import type { DistrictMatchQuality } from "@/lib/db/districts";

export const metadata = { title: "Districts" };

// 1 hour, matching the rest of the site's public data pages — a snapshot rebuilt by ingestion, not
// something that changes within a session.
export const revalidate = 3_600;

const LEGEND_ORDER: DistrictMatchQuality[] = [
  "all_exact",
  "resolved",
  "has_overrides",
  "has_unresolved",
];

export default async function DistrictsPage() {
  const rows = await getDistrictIndex();

  const regionOptions = Array.from(
    new Map(
      rows
        .filter((r): r is typeof r & { regionCode: string; regionName: string } =>
          Boolean(r.regionCode && r.regionName),
        )
        .map((r) => [r.regionCode, r.regionName]),
    ),
  )
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalMembers = rows.reduce((sum, r) => sum + r.memberCount, 0);
  const totalBhw = rows.reduce((sum, r) => sum + r.bhwTotal, 0);
  const gapCount = rows.filter(
    (r) => r.matchQuality === "has_unresolved" || r.matchQuality === "no_members",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Legislative districts</h1>
        <p className="mt-2 max-w-3xl text-muted">
          This mapping of cities, municipalities, and barangays to Philippine legislative districts
          is <strong className="text-foreground">derived from public sources — Wikipedia and
          Wikidata — not published by PSA or COMELEC</strong>. It rests on a single source rather
          than the usual two, because the intended second opinion (COMELEC&apos;s precinct returns)
          is no longer reachable by anyone. Every row below carries the source page and revision it
          came from. If you know your own city, municipality, or barangay is placed wrong, please{" "}
          <a href="/feedback" className="underline hover:text-accent">
            tell us
          </a>{" "}
          — that correction is the second source this mapping is missing.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted">District data is temporarily unavailable.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <div>
              <span className="font-semibold">{rows.length.toLocaleString()}</span>{" "}
              <span className="text-muted">districts</span>
            </div>
            <div>
              <span className="font-semibold">{totalMembers.toLocaleString()}</span>{" "}
              <span className="text-muted">member cities/municipalities/barangays</span>
            </div>
            <div>
              <span className="font-semibold">{totalBhw.toLocaleString()}</span>{" "}
              <span className="text-muted">BHWs covered by a mapped district</span>
            </div>
            {gapCount > 0 && (
              <div>
                <span className="font-semibold text-danger">{gapCount.toLocaleString()}</span>{" "}
                <span className="text-muted">
                  district{gapCount === 1 ? "" : "s"} with a known gap
                </span>
              </div>
            )}
          </div>

          <DistrictIndexTable rows={rows} regionOptions={regionOptions} />

          <section className="flex flex-col gap-2 text-sm">
            <h2 className="text-base font-semibold">What the match-quality badge means</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {LEGEND_ORDER.map((quality) => (
                <div key={quality} className="flex items-start gap-2">
                  <dt>
                    <MatchQualityBadge quality={quality} />
                  </dt>
                  <dd className="text-muted">{MATCH_QUALITY_DESCRIPTION[quality]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">
              There is deliberately no fuzzy-matching rung: a place that couldn&apos;t be resolved
              from a source is left out and reported, never guessed. A gap can only be pinned on a
              specific district here when that district is its own whole province or city with no
              sibling district to share the gap with — a gap inside a province or city split across
              several districts is real but not attributable to one of them from this data alone, so
              it is not shown as a per-district badge.{" "}
              <a
                href="https://github.com/jongsky25/bhw-connect-dashboard/blob/main/docs/LEGISLATIVE_DISTRICTS.md"
                className="underline hover:text-accent"
                target="_blank"
                rel="noopener noreferrer"
              >
                Full build report, including every known gap by name
              </a>
              .
            </p>
          </section>
        </>
      )}
    </div>
  );
}
