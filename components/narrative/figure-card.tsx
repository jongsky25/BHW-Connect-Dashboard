import type { ReactNode } from "react";

export type FigureCardProps = {
  /** Figure title, e.g. "Accreditation status". */
  title: string;
  /** WPSAR-style Person/Place/Time line, e.g. "N = 270,917 BHWs · Philippines · 2025 snapshot". */
  caption: string;
  /** One-sentence plain-language takeaway, e.g. "About 7 in 10 BHWs here are accredited." */
  headline: string;
  /** The chart, table, or other figure content. */
  children: ReactNode;
  /** Exact N/denominator, definitions used, suppression note — collapsed by default. */
  technicalDetails?: ReactNode;
  /** Rendered next to the title when this increment wires up CSV/XLSX/PNG/PPTX (increment 1.8). */
  exportMenu?: ReactNode;
};

/**
 * The shared figure contract used on every chart/stat in the app (BUILD_PLAN.md §4.2):
 * title, Person/Place/Time caption, the figure itself, a layman headline, and a
 * collapsed technical-details disclosure. Keeping this one component means every
 * figure across explore/place/compare looks and behaves the same way.
 */
export function FigureCard({
  title,
  caption,
  headline,
  children,
  technicalDetails,
  exportMenu,
}: FigureCardProps) {
  return (
    <section className="rounded-lg border border-border bg-background p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted">{caption}</p>
        </div>
        {exportMenu}
      </div>

      <div className="mt-4">{children}</div>

      <p className="mt-4 text-sm font-medium">{headline}</p>

      {technicalDetails && (
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer select-none font-medium hover:text-accent">
            Technical details
          </summary>
          <div className="mt-2 space-y-1">{technicalDetails}</div>
        </details>
      )}
    </section>
  );
}
