import { FigureCard } from "@/components/narrative/figure-card";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { CohortRow } from "@/lib/db/derived-figures";
import type { GeoLevel } from "@/lib/filters/schema";

const KIND_LABEL: Record<CohortRow["kind"], string> = {
  first_active: "First became active",
  registered: "Registered",
  accredited: "Accredited",
};

// The order the three waves are shown in — joining first, then registration,
// then accreditation, roughly the order a BHW moves through them.
const KIND_ORDER: CohortRow["kind"][] = ["first_active", "registered", "accredited"];

/** A single wave rendered as a year-by-year column strip (server DOM, no JS). */
function WaveStrip({
  label,
  byYear,
  years,
  peak,
}: {
  label: string;
  byYear: Map<number, number>;
  years: number[];
  peak: number;
}) {
  const total = years.reduce((s, y) => s + (byYear.get(y) ?? 0), 0);
  const ariaLabel =
    `${label}: ${total.toLocaleString()} BHWs across ${years[0]}–${years[years.length - 1]}. ` +
    years
      .filter((y) => (byYear.get(y) ?? 0) > 0)
      .map((y) => `${y}: ${(byYear.get(y) ?? 0).toLocaleString()}`)
      .join("; ");

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex h-16 items-end gap-px" role="img" aria-label={ariaLabel}>
        {years.map((y) => {
          const n = byYear.get(y) ?? 0;
          const h = peak > 0 ? Math.max(n > 0 ? 2 : 0, (n / peak) * 100) : 0;
          return (
            <span
              key={y}
              className="flex-1 rounded-t-sm"
              style={{ height: `${h}%`, backgroundColor: "var(--seq-4)", minWidth: "2px" }}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Year "waves" (E3.2): when today's profiled BHWs reached each milestone —
 * registered, accredited, and first became active — read from the 2025 snapshot.
 * Three small-multiple column strips (one per milestone), server-rendered as DOM
 * so the page keeps no extra client JS. This is NOT a workforce time series: it
 * only shows the years recorded for BHWs still in the 2025 registry, so it can't
 * speak to anyone who has since left.
 *
 * Built at national/region/province/citymun; a barangay falls back to its citymun
 * ancestor (labeled), like the training/completeness figures.
 */
export function CohortsFigure({
  rows,
  caption,
  geoLevel,
  fallbackCitymunName,
}: {
  rows: CohortRow[];
  caption: string;
  geoLevel: GeoLevel;
  /** When set, `rows` describe this citymun (the barangay has no cohort rows). */
  fallbackCitymunName?: string | null;
}) {
  if (rows.length === 0) {
    return (
      <FigureCard
        title="Joining waves"
        caption={caption}
        headline={
          geoLevel === "barangay"
            ? "Year-of-joining figures aren't available at the barangay level."
            : "No year-of-joining data for this area."
        }
        technicalDetails={
          <p>
            The waves figure is built down to the city/municipality level. Barangay pages show their
            city/municipality&apos;s figure instead.
          </p>
        }
      >
        <p className="text-sm text-muted">No data available.</p>
      </FigureCard>
    );
  }

  const minYear = Math.min(...rows.map((r) => r.cohortYear));
  const maxYear = Math.max(...rows.map((r) => r.cohortYear));
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  const seriesByKind = new Map<CohortRow["kind"], Map<number, number>>();
  for (const kind of KIND_ORDER) seriesByKind.set(kind, new Map());
  for (const r of rows) seriesByKind.get(r.kind)?.set(r.cohortYear, r.n);

  // "First became active" is the clearest join-timing signal — headline off it.
  const firstActive = seriesByKind.get("first_active") ?? new Map();
  const faTotal = years.reduce((s, y) => s + (firstActive.get(y) ?? 0), 0);
  let peakYear = minYear;
  let peakN = -1;
  for (const y of years) {
    const n = firstActive.get(y) ?? 0;
    if (n > peakN) {
      peakN = n;
      peakYear = y;
    }
  }
  const last5 = years.filter((y) => y >= maxYear - 4).reduce((s, y) => s + (firstActive.get(y) ?? 0), 0);
  const last5Pct = faTotal > 0 ? Math.round((100 * last5) / faTotal) : null;

  const scopeSuffix = fallbackCitymunName ? ` (shown for ${fallbackCitymunName})` : "";

  const headline =
    faTotal > 0
      ? `Most of today's BHWs here first became active around ${peakYear}` +
        (last5Pct !== null ? `; ${last5Pct}% joined in the last five recorded years.` : ".")
      : "No year-of-joining data for this area.";

  return (
    <FigureCard
      title={`Joining waves${scopeSuffix}`}
      caption={caption}
      headline={headline}
      technicalDetails={
        <>
          <p>
            Each strip counts how many of the BHWs profiled in the 2025 snapshot reached that
            milestone in each year — <strong>{KIND_LABEL.first_active.toLowerCase()}</strong> (from
            their <GlossaryTerm slug="active_years">service-year list</GlossaryTerm>),{" "}
            <strong>registered</strong>, and <strong>accredited</strong>. Bar heights are scaled
            within each strip, so the three aren&apos;t directly comparable in height — only in
            shape.
          </p>
          <p>
            Years are as recorded in the 2025 snapshot. This is not a picture of the whole workforce
            over time: it counts only BHWs still in the 2025 registry, so BHWs who joined and later
            left before 2025 are not shown. Read the waves as &ldquo;when today&apos;s BHWs
            arrived,&rdquo; not &ldquo;how many BHWs there were each year.&rdquo;
          </p>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {KIND_ORDER.map((kind) => {
          const series = seriesByKind.get(kind) ?? new Map();
          const peak = Math.max(0, ...years.map((y) => series.get(y) ?? 0));
          if (peak === 0) return null;
          return (
            <WaveStrip key={kind} label={KIND_LABEL[kind]} byYear={series} years={years} peak={peak} />
          );
        })}
        <div className="flex justify-between text-[0.65rem] text-muted" aria-hidden="true">
          <span>{minYear}</span>
          <span>{maxYear}</span>
        </div>
      </div>
    </FigureCard>
  );
}
