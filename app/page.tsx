import { getBhwCounts, getCertification, getHonorarium, getDemographics, hsGradOrAbovePct } from "@/lib/db/indicators";
import { getBhwOverview, coverageForDisplay } from "@/lib/db/stepzero";
import { getHomeInsights } from "@/lib/db/insights";
import type { DemographicRow } from "@/lib/db/indicators";
import type { BarDatum } from "@/lib/charts/bar-chart";
import { formatCount, formatPct } from "@/lib/format";
import { GeoSearch } from "@/components/home/geo-search";
import { StatHero } from "@/components/home/stat-hero";
import { StatTile } from "@/components/home/stat-tile";
import { Donut, Gauge, LadderBars } from "@/components/home/mini-viz";
import { InsightsGrid } from "@/components/insights/insights-grid";
import { CertificationFigure } from "@/components/explore/certification-figure";
import { HonorariumFigure } from "@/components/explore/honorarium-figure";
import { HonorariumAmountFigure } from "@/components/explore/honorarium-amount-figure";
import { HonorariumDistributionFigure } from "@/components/explore/honorarium-distribution-figure";
import { AiInsight } from "@/components/narrative/ai-insight";
import { ChatLauncher } from "@/components/chat/chat-launcher";

// Educational-attainment categories, lowest to highest. "High school graduate or
// higher" (lib/db/indicators.ts's HS_GRAD_AND_ABOVE) sums every level at High
// School Graduate and above (including the Vocational Degree category, which is
// post-secondary). Ladder order is also used to sort the ladder-bars visual and
// the enlarged breakdown instead of by count.
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

function educationTile(rows: DemographicRow[]): {
  hsPlusPct: number;
  rows: { label: string; n: number; pct: number }[];
  hasData: boolean;
} {
  const byCat = new Map(rows.filter((r) => !r.isSuppressed).map((r) => [r.category, r]));
  const ordered = [
    ...EDUCATION_LADDER.filter((c) => byCat.has(c)),
    ...[...byCat.keys()].filter((c) => !EDUCATION_LADDER.includes(c)),
  ];
  const rowsOut = ordered
    .map((c) => byCat.get(c)!)
    .filter((r) => r.n !== null && r.pct !== null)
    .map((r) => ({ label: r.category, n: r.n as number, pct: r.pct as number }));
  return { hsPlusPct: hsGradOrAbovePct(rows) ?? 0, rows: rowsOut, hasData: byCat.size > 0 };
}

export default async function Home() {
  const [overview, counts, certification, honorarium, education, insights] = await Promise.all([
    getBhwOverview("PH", "national"),
    getBhwCounts("PH", "national"),
    getCertification("PH", "national"),
    getHonorarium("PH", "national"),
    getDemographics("PH", "national", ["education"]),
    getHomeInsights(),
  ]);

  const coverage = coverageForDisplay(overview);
  // Per-person figures are computed from the individually-profiled subset, so
  // their Person/Place/Time line is captioned against validated profiles — not
  // the StepZero universe total.
  const profiledCaption = `N = ${formatCount(overview.validatedProfiles)} validated profiles · Philippines · 2025 snapshot`;
  const totalCaption = `N = ${formatCount(overview.totalBhw)} BHWs · Philippines · 2025 snapshot`;
  const coverageCaption =
    coverage !== null
      ? `≈${coverage}% of registered BHWs profiled (non-registered excluded)`
      : "individually profiled BHWs";

  // Item 1 — Total BHWs = StepZero registered + registered & accredited +
  // non-registered (the LGU-declared headcount from before profiling).
  const registrationMix = [
    { label: "Registered", value: overview.nRegistered ?? 0, color: "var(--seq-3)" },
    { label: "Registered & accredited", value: overview.nRegisteredAccredited ?? 0, color: "var(--seq-6)" },
    { label: "Non-registered (LGU-declared)", value: overview.nonRegistered ?? 0, color: "var(--seq-1)" },
  ];
  const totalChartData: BarDatum[] = registrationMix.map(({ label, value }) => ({ label, value }));

  // Item 2/3 — Validated profiles break down into accredited vs. not-yet-accredited
  // (the per-person accreditation flag), disaggregating the profiled BHWs.
  const notYetAccredited =
    counts?.nTotal != null && counts?.nAccredited != null
      ? counts.nTotal - counts.nAccredited
      : null;
  const accreditationChartData: BarDatum[] =
    counts?.nAccredited != null && notYetAccredited !== null
      ? [
          { label: "Accredited", value: counts.nAccredited },
          { label: "Not yet accredited", value: notYetAccredited },
        ]
      : [];

  const edu = educationTile(education);
  const educationChartData: BarDatum[] = edu.rows.map((r) => ({ label: r.label, value: r.pct, count: r.n }));

  const per1000ChartData: BarDatum[] =
    overview.totalBhw !== null && overview.population !== null
      ? [
          { label: "Total BHWs", value: overview.totalBhw },
          { label: "Population", value: overview.population },
        ]
      : [];

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

      <section aria-label="National figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatHero
          label="Total BHWs"
          value={formatCount(overview.totalBhw)}
          caption="Registered/accredited + non-registered (LGU-declared, pre-profiling) · 2025"
          registrationMix={overview.hasStepzero ? registrationMix : undefined}
          enlarge={
            overview.hasStepzero
              ? {
                  title: "Total BHWs breakdown",
                  caption: totalCaption,
                  chartData: totalChartData,
                  xLabel: "BHWs",
                  yLabel: "Class",
                }
              : undefined
          }
        />
        <StatTile
          label="Validated profiles"
          value={formatCount(overview.validatedProfiles)}
          caption={coverageCaption}
          visual={
            counts?.pctAccredited != null ? (
              <Donut pct={counts.pctAccredited} ariaLabel={`${counts.pctAccredited}% accredited`} />
            ) : undefined
          }
          enlarge={
            accreditationChartData.length > 0
              ? {
                  title: "Validated profiles: accredited vs. not yet",
                  caption: profiledCaption,
                  chartData: accreditationChartData,
                  xLabel: "BHWs",
                  yLabel: "Status",
                }
              : undefined
          }
        />
        <StatTile
          label="Accredited"
          value={formatPct(counts?.pctAccredited ?? null)}
          caption={profiledCaption}
          visual={
            counts?.pctAccredited != null ? (
              <Gauge value={counts.pctAccredited} max={100} ariaLabel={`${counts.pctAccredited}% accredited`} />
            ) : undefined
          }
          enlarge={
            accreditationChartData.length > 0
              ? {
                  title: "Accredited vs. not accredited",
                  caption: profiledCaption,
                  chartData: accreditationChartData,
                  xLabel: "BHWs",
                  yLabel: "Status",
                }
              : undefined
          }
        />
        <StatTile
          label="Educational attainment"
          value={edu.hasData ? `${edu.hsPlusPct}%` : "—"}
          caption="High school graduate or higher · validated profiles · 2025"
          visual={edu.rows.length > 0 ? <LadderBars rows={edu.rows} ariaLabel="Educational attainment, by category" /> : undefined}
          enlarge={
            educationChartData.length > 0
              ? {
                  title: "Educational attainment",
                  caption: profiledCaption,
                  chartData: educationChartData,
                  xLabel: "% of BHWs",
                  yLabel: "Category",
                  valueFormat: "percent",
                }
              : undefined
          }
        />
        <StatTile
          label="BHWs per 1,000 residents"
          value={overview.bhwPer1000Residents === null ? "—" : overview.bhwPer1000Residents.toLocaleString()}
          caption={
            overview.population !== null
              ? `Total BHWs per population of ${formatCount(overview.population)} · StepZero · 2025`
              : "Population data not available"
          }
          visual={
            overview.bhwPer1000Residents !== null ? (
              <Gauge
                value={overview.bhwPer1000Residents}
                max={Math.max(5, overview.bhwPer1000Residents * 1.5)}
                ariaLabel={`${overview.bhwPer1000Residents} BHWs per 1,000 residents`}
              />
            ) : undefined
          }
          enlarge={
            per1000ChartData.length > 0
              ? {
                  title: "BHWs vs. population",
                  caption: totalCaption,
                  chartData: per1000ChartData,
                  xLabel: "Count",
                  yLabel: "Metric",
                }
              : undefined
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
        . Tap any figure to see the full breakdown.
      </p>

      <AiInsight geoCode="PH" geoLevel="national" geoName="Philippines" />

      <section aria-label="National breakdowns" className="flex flex-col gap-6">
        <CertificationFigure rows={certification} caption={profiledCaption} />
        <HonorariumFigure rows={honorarium} caption={profiledCaption} />
        <HonorariumAmountFigure rows={honorarium} caption={profiledCaption} />
        <HonorariumDistributionFigure rows={honorarium} caption={profiledCaption} />
      </section>

      <InsightsGrid insights={insights} />

      <ChatLauncher geoCode="PH" geoLevel="national" geoName="Philippines" />
    </div>
  );
}
