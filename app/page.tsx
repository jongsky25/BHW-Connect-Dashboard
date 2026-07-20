import { getBhwCounts, getCertification, getHonorarium, getDemographics } from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { getSpotlightInsight } from "@/lib/db/spotlight";
import type { DemographicRow } from "@/lib/db/indicators";
import { GeoSearch } from "@/components/home/geo-search";
import { StatTile, type StatTileDetail } from "@/components/home/stat-tile";
import { CertificationFigure } from "@/components/explore/certification-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { HonorariumAmountFigure } from "@/components/explore/honorarium-amount-figure";
import { AiInsight } from "@/components/narrative/ai-insight";
import { ChatLauncher } from "@/components/chat/chat-launcher";

function formatCount(n: number | null) {
  return n === null ? "—" : n.toLocaleString();
}

function formatPct(n: number | null) {
  return n === null ? "—" : `${n}%`;
}

// Educational-attainment categories, lowest to highest. "High school graduate or
// higher" sums every level at High School Graduate and above (including the
// Vocational Degree category, which is post-secondary). Ladder order is also used
// to sort the expandable breakdown instead of by count.
const EDUCATION_LADDER = [
  "No Formal Education",
  "Elementary Level",
  "Elementary Graduate",
  "High School Level",
  "High School Graduate",
  "Vocational Degree",
  "College Level",
  "College Graduate",
  "Masteral Degree",
];
const HS_GRAD_AND_ABOVE = new Set([
  "High School Graduate",
  "Vocational Degree",
  "College Level",
  "College Graduate",
  "Masteral Degree",
]);

function educationTile(rows: DemographicRow[]): {
  hsPlusPct: number;
  details: StatTileDetail[];
  hasData: boolean;
} {
  const byCat = new Map(rows.filter((r) => !r.isSuppressed).map((r) => [r.category, r]));
  let hsPlus = 0;
  for (const [cat, r] of byCat) {
    if (HS_GRAD_AND_ABOVE.has(cat) && r.pct !== null) hsPlus += r.pct;
  }
  const ordered = [
    ...EDUCATION_LADDER.filter((c) => byCat.has(c)),
    ...[...byCat.keys()].filter((c) => !EDUCATION_LADDER.includes(c)),
  ];
  const details = ordered.map((c) => {
    const r = byCat.get(c)!;
    return { label: c, value: `${formatCount(r.n)} (${r.pct ?? "—"}%)` };
  });
  return { hsPlusPct: Math.round(hsPlus), details, hasData: byCat.size > 0 };
}

export default async function Home() {
  const [overview, counts, certification, honorarium, education, spotlight] = await Promise.all([
    getBhwOverview("PH", "national"),
    getBhwCounts("PH", "national"),
    getCertification("PH", "national"),
    getHonorarium("PH", "national"),
    getDemographics("PH", "national", ["education"]),
    getSpotlightInsight(),
  ]);

  const coverage = coverageForDisplay(overview);
  // Per-person figures are computed from the individually-profiled subset, so
  // their Person/Place/Time line is captioned against validated profiles — not
  // the StepZero universe total.
  const profiledCaption = `N = ${formatCount(overview.validatedProfiles)} validated profiles · Philippines · 2025 snapshot`;
  const coverageCaption =
    coverage !== null
      ? `≈${coverage}% of registered BHWs profiled (non-registered excluded)`
      : "individually profiled BHWs";

  // Item 1 — Total BHWs = StepZero registered + registered & accredited +
  // non-registered (the LGU-declared headcount from before profiling).
  const totalDetails: StatTileDetail[] = [
    { label: "Registered", value: formatCount(overview.nRegistered) },
    { label: "Registered & accredited", value: formatCount(overview.nRegisteredAccredited) },
    { label: "Non-registered (LGU-declared)", value: formatCount(overview.nonRegistered) },
  ];

  // Item 2/3 — Validated profiles break down into accredited vs. not-yet-accredited
  // (the per-person accreditation flag), disaggregating the profiled BHWs.
  const notYetAccredited =
    counts?.nTotal != null && counts?.nAccredited != null
      ? counts.nTotal - counts.nAccredited
      : null;
  const validatedDetails: StatTileDetail[] = [
    { label: "Accredited", value: formatCount(counts?.nAccredited ?? null) },
    { label: "Not yet accredited", value: formatCount(notYetAccredited) },
  ];

  const edu = educationTile(education);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <section className="flex flex-col items-center gap-5 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Barangay Health Workers, in your barangay
        </h1>
        <p className="max-w-2xl text-muted">
          BHW Connect is a public dashboard on the Philippines&apos; Barangay Health Worker
          workforce — accreditation, training, and support, down to the city/municipality level.
        </p>
        <GeoSearch />
      </section>

      <section
        aria-label="National figures"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <StatTile
          label="Total BHWs"
          value={formatCount(overview.totalBhw)}
          caption="Registered/accredited + non-registered (LGU-declared, pre-profiling) · 2025"
          details={overview.hasStepzero ? totalDetails : undefined}
        />
        <StatTile
          label="Validated profiles"
          value={formatCount(overview.validatedProfiles)}
          caption={coverageCaption}
          details={counts?.nTotal != null ? validatedDetails : undefined}
        />
        <StatTile
          label="Accredited"
          value={formatPct(counts?.pctAccredited ?? null)}
          caption={profiledCaption}
        />
        <StatTile
          label="Educational attainment"
          value={edu.hasData ? `${edu.hsPlusPct}%` : "—"}
          caption="High school graduate or higher · validated profiles · 2025"
          details={edu.hasData ? edu.details : undefined}
        />
        <StatTile
          label="BHWs per 1,000 residents"
          value={
            overview.bhwPer1000Residents === null
              ? "—"
              : overview.bhwPer1000Residents.toLocaleString()
          }
          caption={
            overview.population !== null
              ? `Total BHWs per population of ${formatCount(overview.population)} · StepZero · 2025`
              : "Population data not available"
          }
        />
      </section>

      <p className="-mt-4 text-center text-xs text-muted">
        Total BHWs comes from the DOH StepZero quick-count (the LGU-declared headcount). Every
        per-person figure below describes the {formatCount(overview.validatedProfiles)} individually
        validated profiles
        {coverage !== null && overview.registeredUniverse !== null
          ? ` — about ${coverage}% of the country's ${formatCount(overview.registeredUniverse)} registered BHWs`
          : ""}
        . Tap Total BHWs or Validated profiles to see the classification breakdown.
      </p>

      <AiInsight geoCode="PH" geoLevel="national" geoName="Philippines" />

      <section aria-label="National breakdowns" className="flex flex-col gap-6">
        <CertificationFigure rows={certification} caption={profiledCaption} />
        <HonorariumFigure rows={honorarium} caption={profiledCaption} />
        <HonorariumAmountFigure rows={honorarium} caption={profiledCaption} />
      </section>

      {spotlight && (
        <section
          aria-label="Spotlight insight"
          className="rounded-lg border border-accent/30 bg-accent-subtle p-5 sm:p-6"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Spotlight insight</p>
          <p className="mt-2 text-lg font-medium">{spotlight.headline}</p>
          <p className="mt-1 text-xs text-muted">{spotlight.caption}</p>
        </section>
      )}

      <ChatLauncher geoCode="PH" geoLevel="national" geoName="Philippines" />
    </div>
  );
}
