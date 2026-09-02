import Link from "next/link";
import { notFound } from "next/navigation";
import { coverageOf, getAreaProfile, type ProfileSection } from "@/lib/db/area-profile";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";
import { GeoSearch } from "@/components/home/geo-search";

/**
 * The consolidated area profile (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.4), rendered from the
 * same `getAreaProfile` the assistant's tool calls — one assembler, so the page and an answer
 * about the same place cannot disagree.
 *
 * **Admin-only, and that is load-bearing.** It consolidates figures across every dataset and
 * surfaces passages from the internal document corpus (§12.5), and the cross-dataset differencing
 * risk in `area-profile-suppression.ts` is the reason it must not become a public surface. The
 * `(dashboard)` layout's `getAdminAuthResult()` gate is the boundary; nothing here is cached and
 * nothing is written to `ai_ask_cache`.
 *
 * The "What this profile does not have" section is the point of the page, not a footnote: a
 * dataset that stops at city/municipality and a dataset with no row for this place are different
 * findings, and a reader who cannot tell them apart will report a build decision as a data gap.
 */

type Params = { geoLevel: string; geoCode: string };

const isGeoLevel = (value: string): value is GeoLevel =>
  (GEO_LEVELS as readonly string[]).includes(value);

/** Human labels for the section keys, so the coverage list reads as findings rather than fields. */
const SECTION_LABEL: Record<string, string> = {
  bhwOverview: "BHW census overview",
  bhwCounts: "Validated-profile counts",
  demographics: "Demographic breakdowns",
  training: "Training coverage",
  honorarium: "Honorarium receipt",
  honorariumSufficiency: "Honorarium sufficiency",
  profilingStatus: "2026 profiling status",
  uucPhcCounts: "UUC for PHC listing",
  uucPhcCriteria: "UUC for PHC qualifying routes",
  uucBhwCoverage: "UUC listed vs other BHW coverage",
  poverty: "Poverty incidence (PSA SAE)",
  population: "Census population (PSA 2024)",
  peerRanks: "Peer ranks",
  documents: "Document passages naming this place",
};

const label = (key: string) => SECTION_LABEL[key] ?? key;

function SectionCard({
  title,
  section,
  children,
}: {
  title: string;
  section: ProfileSection<unknown>;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="font-mono text-[11px] text-muted">{section.state}</span>
      </div>
      {section.reason && <p className="mt-1 text-xs text-muted">{section.reason}</p>}
      {children}
    </section>
  );
}

export default async function AdminAreaProfilePage({ params }: { params: Promise<Params> }) {
  const { geoLevel, geoCode } = await params;
  if (!isGeoLevel(geoLevel)) notFound();

  const profile = await getAreaProfile(geoCode, geoLevel);
  if (!profile) notFound();

  const coverage = coverageOf(profile);
  const sections = Object.entries(profile.sections) as [string, ProfileSection<unknown>][];
  const withData = sections.filter(([, s]) => s.state === "present" || s.state === "suppressed");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{profile.geo.geoName}</h2>
        <p className="text-xs text-muted">
          {profile.geo.geoLevel} · <span className="font-mono">{profile.geo.geoCode}</span> ·
          admin-only consolidated profile across every dataset that covers this place.
        </p>
      </div>

      <GeoSearch />

      {profile.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-4 text-xs text-muted">
          {profile.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      {/* Deliberately first. A reader who scrolls past a list of figures and never reaches the
          gaps will quote the figures as if they were the whole picture. */}
      <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold">
          What this profile does not have ({coverage.absent.length} of {sections.length})
        </h3>
        {coverage.absent.length === 0 ? (
          <p className="mt-2 text-xs text-muted">Every dataset has a figure for this place.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {coverage.absent.map((entry) => (
              <li key={entry.source} className="border-l-2 border-border pl-3 text-sm">
                <p className="font-medium">{label(entry.source)}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{entry.state}</span> — {entry.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {withData.map(([key, section]) => (
          <SectionCard key={key} title={label(key)} section={section}>
            {/* The payload shapes differ per dataset and each already has a purpose-built figure
                on its own public page; this admin view shows the values verbatim rather than
                re-implementing fourteen renderers, and links out to the built figures. */}
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface p-2 text-[11px] leading-relaxed">
              {JSON.stringify(section.data, null, 2)}
            </pre>
          </SectionCard>
        ))}
      </div>

      <p className="text-xs text-muted">
        Built figures for this place:{" "}
        <Link href={`/place/${profile.geo.geoLevel}/${profile.geo.geoCode}`} className="underline">
          public place profile
        </Link>
        {" · "}
        <Link
          href={`/uuc-phc/${profile.geo.geoLevel}/${profile.geo.geoCode}`}
          className="underline"
        >
          UUC for PHC
        </Link>
        {" · "}
        <Link
          href={`/profiling-status/${profile.geo.geoLevel}/${profile.geo.geoCode}`}
          className="underline"
        >
          profiling status
        </Link>
      </p>
    </div>
  );
}
