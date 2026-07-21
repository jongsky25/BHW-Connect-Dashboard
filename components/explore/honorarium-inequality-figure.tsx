import { FigureCard } from "@/components/narrative/figure-card";
import { GlossaryTerm } from "@/components/glossary/glossary-term";
import type { HonorariumInequalityRow } from "@/lib/db/derived-figures";
import type { GeoLevel } from "@/lib/filters/schema";
import { formatPeso } from "@/lib/format";

/** Plain-language band for a Gini coefficient among honorarium recipients. */
function giniBand(g: number): string {
  if (g < 0.2) return "fairly even";
  if (g < 0.35) return "moderately uneven";
  if (g < 0.5) return "uneven";
  return "very uneven";
}

/**
 * Honorarium inequality (E3.5): among BHWs who receive any honorarium in this
 * area, how unequal are the total monthly amounts? Shows the Gini coefficient and
 * the p90:p10 ratio. Built at national/region/province/citymun; a barangay falls
 * back to its citymun ancestor (labeled). Suppressed for fewer than 5 recipients.
 */
export function HonorariumInequalityFigure({
  row,
  caption,
  geoLevel,
  fallbackCitymunName,
}: {
  row: HonorariumInequalityRow | null;
  caption: string;
  geoLevel: GeoLevel;
  fallbackCitymunName?: string | null;
}) {
  const scopeSuffix = fallbackCitymunName ? ` (shown for ${fallbackCitymunName})` : "";
  const title = `Honorarium inequality${scopeSuffix}`;

  if (!row || row.isSuppressed || row.gini === null) {
    return (
      <FigureCard
        title={title}
        caption={caption}
        headline={
          geoLevel === "barangay" && !row
            ? "Inequality figures aren't available at the barangay level."
            : row?.isSuppressed
              ? "Too few BHWs receive honorarium here to show an inequality figure."
              : "No honorarium-inequality data for this area."
        }
        technicalDetails={
          <p>
            The inequality figure is built down to the city/municipality level and hidden where
            fewer than 5 BHWs receive honorarium, since a spread over 1–4 amounts could reveal an
            individual&apos;s pay. Barangay pages show their city/municipality&apos;s figure instead.
          </p>
        }
      >
        <p className="text-sm text-muted">No data available.</p>
      </FigureCard>
    );
  }

  const ratioText =
    row.p90p10Ratio !== null ? `${row.p90p10Ratio}×` : "several times";

  const headline =
    row.p90p10Ratio !== null
      ? `The best-paid tenth of BHWs here receive at least ${ratioText} what the least-paid tenth receive.`
      : `Honorarium amounts among recipients here are ${giniBand(row.gini)}.`;

  return (
    <FigureCard
      title={title}
      caption={caption}
      headline={headline}
      technicalDetails={
        <>
          <p>
            Among the {row.nReceiving.toLocaleString()} BHWs receiving any{" "}
            <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> here, we total each
            person&apos;s monthly honorarium across every paying level, then measure how unevenly
            those totals are spread. The{" "}
            <GlossaryTerm slug="gini">Gini coefficient</GlossaryTerm> is{" "}
            <strong>{row.gini}</strong> ({giniBand(row.gini)}) — 0 would mean everyone receives the
            same, 1 would mean one person receives everything.
          </p>
          <p>
            The lowest-paid tenth receive up to {formatPeso(row.p10Amount)} a month; the best-paid
            tenth at least {formatPeso(row.p90Amount)} — a ratio of {ratioText}. This compares
            amounts among recipients only; BHWs who receive no honorarium at all are covered in the
            &ldquo;Who receives&rdquo; tab.
          </p>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">
            <GlossaryTerm slug="gini">Gini</GlossaryTerm>
          </dt>
          <dd className="text-lg font-semibold">{row.gini}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">p90 : p10 ratio</dt>
          <dd className="text-lg font-semibold">{ratioText}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Lowest tenth (≤ p10)</dt>
          <dd className="text-lg font-semibold">{formatPeso(row.p10Amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Best-paid tenth (≥ p90)</dt>
          <dd className="text-lg font-semibold">{formatPeso(row.p90Amount)}</dd>
        </div>
      </dl>
    </FigureCard>
  );
}
