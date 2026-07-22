import { FigureCard } from "@/components/narrative/figure-card";
import { FigureView } from "@/components/charts/figure-view";
import { ExportMenu } from "@/components/narrative/export-menu";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import { FigureBenchmark, type FigureBenchmarkProps } from "@/components/narrative/figure-benchmark";
import {
  HONORARIUM_SUFFICIENCY_DAILY_PHP,
  HONORARIUM_SUFFICIENCY_MONTHLY_PHP,
} from "@/lib/analysis/thresholds";
import type { HonorariumSufficiencyRow } from "@/lib/db/derived-figures";
import type { GeoLevel } from "@/lib/filters/schema";
import { formatPeso } from "@/lib/format";

/**
 * Honorarium sufficiency (Increment 3, deck headline "59% receive less than
 * ₱68/day"): among ALL profiled BHWs here — not just those who receive some
 * honorarium — how does each person's cumulative, all-levels honorarium
 * compare to the ₱{HONORARIUM_SUFFICIENCY_MONTHLY_PHP}/month sufficiency cut?
 * Contrast the "Distribution" and "Inequality" honorarium tabs, which describe
 * amounts among recipients only. Built at national/region/province/citymun; a
 * barangay falls back to its citymun ancestor (labeled). Suppressed for geos
 * with fewer than 5 profiled BHWs; individual bands with 1–4 BHWs are withheld
 * even when the geo overall isn't suppressed.
 */
export function HonorariumSufficiencyFigure({
  data,
  caption,
  geoCode,
  geoLevel,
  fallbackCitymunName,
  benchmark,
}: {
  data: HonorariumSufficiencyRow | null;
  caption: string;
  geoCode: string;
  geoLevel: GeoLevel;
  fallbackCitymunName?: string | null;
  benchmark?: FigureBenchmarkProps;
}) {
  const scopeSuffix = fallbackCitymunName ? ` (shown for ${fallbackCitymunName})` : "";
  const title = `Honorarium sufficiency${scopeSuffix}`;

  if (!data || data.isSuppressed || data.pctBelowSufficiency === null) {
    return (
      <FigureCard
        title={title}
        caption={caption}
        headline={
          geoLevel === "barangay" && !data
            ? "Sufficiency figures aren't available at the barangay level."
            : data?.isSuppressed
              ? "Too few profiled BHWs here to show a sufficiency figure."
              : "No honorarium-sufficiency data for this area."
        }
        technicalDetails={
          <p>
            The sufficiency figure is built down to the city/municipality level and hidden where
            fewer than 5 BHWs are profiled. Barangay pages show their city/municipality&apos;s
            figure instead.
          </p>
        }
        benchmark={benchmark ? <FigureBenchmark {...benchmark} /> : undefined}
      >
        <p className="text-sm text-muted">No data available.</p>
      </FigureCard>
    );
  }

  const visibleBands = data.bands.filter((b) => !b.isSuppressed && b.pct !== null);
  const suppressedBands = data.bands.filter((b) => b.isSuppressed);
  const chartData = visibleBands.map((b) => ({
    label: b.bandLabel,
    value: b.pct as number,
    count: b.n ?? undefined,
  }));

  const medianDaily =
    data.medianCumulativeMonthly !== null ? Math.round(data.medianCumulativeMonthly / 30) : null;

  const headline =
    `${data.pctBelowSufficiency}% of profiled BHWs here receive less than ₱${HONORARIUM_SUFFICIENCY_DAILY_PHP.toFixed(0)} per day in total honorarium` +
    (medianDaily !== null && data.medianCumulativeMonthly !== null
      ? ` (median ₱${medianDaily}/day, ${formatPeso(data.medianCumulativeMonthly)}/month).`
      : ".");

  return (
    <FigureCard
      title={title}
      caption={caption}
      exportMenu={<ExportMenu geoCode={geoCode} geoLevel={geoLevel} indicator="honorarium_sufficiency" />}
      headline={headline}
      technicalDetails={
        <>
          <p>
            Unlike the &ldquo;Distribution&rdquo; and &ldquo;Inequality&rdquo; tabs — which describe
            amounts only among BHWs who receive some{" "}
            <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> — this figure&apos;s
            denominator is every profiled BHW here, including those who receive none. Each BHW&apos;s
            honorarium is summed across every paying level (region, province, city/municipality,
            barangay) into one{" "}
            <GlossaryTerm slug="honorarium_sufficiency">cumulative monthly total</GlossaryTerm>,
            then grouped into the bands below.
          </p>
          <p>
            The sufficiency cut is ₱{HONORARIUM_SUFFICIENCY_MONTHLY_PHP.toLocaleString()} a month
            (≈₱{HONORARIUM_SUFFICIENCY_DAILY_PHP.toFixed(0)}/day, using a 30-day month convention).
            Bands with fewer than 5 BHWs are withheld to prevent re-identification
            {suppressedBands.length > 0
              ? `: ${suppressedBands.map((b) => b.bandLabel).join(", ")}.`
              : "."}{" "}
            Built down to the city/municipality level; barangay pages show their
            city/municipality&apos;s figure instead.
          </p>
        </>
      }
      benchmark={benchmark ? <FigureBenchmark {...benchmark} /> : undefined}
    >
      {chartData.length > 0 ? (
        <FigureView
          title={title}
          caption={caption}
          data={chartData}
          xLabel="% of profiled BHWs"
          yLabel="Cumulative monthly honorarium"
          valueSuffix="%"
        />
      ) : (
        <p className="text-sm text-muted">No data available.</p>
      )}
    </FigureCard>
  );
}
