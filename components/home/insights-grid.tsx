import Link from "next/link";
import type { InsightCard } from "@/lib/db/insights";
import type { GeoLevel } from "@/lib/filters/schema";

const LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "National",
  region: "Regional",
  province: "Provincial",
  citymun: "City/Municipality",
  barangay: "Barangay",
};

/** Per-category insight cards — one per area with data, replacing the single
 * rotating spotlight so patterns in every category are visible at once.
 * Scoped to whichever geo level the caller passes (national on the home
 * page; region/province/etc. on place & explore pages), so the headline
 * reflects the level the user has filtered into. */
export function InsightsGrid({
  insights,
  geoLevel = "national",
  geoName = "Philippines",
}: {
  insights: InsightCard[];
  geoLevel?: GeoLevel;
  geoName?: string;
}) {
  if (insights.length === 0) return null;

  return (
    <section aria-labelledby="insights-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="insights-heading" className="text-lg font-semibold tracking-tight">
          Insights
        </h2>
        <p className="text-xs text-muted">
          {LEVEL_LABEL[geoLevel]} · {geoName}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight) => {
          const content = (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-accent">{insight.category}</p>
              <p className="mt-2 text-base font-medium">{insight.headline}</p>
              <p className="mt-1 text-xs text-muted">{insight.caption}</p>
            </>
          );

          const className = "rounded-lg border border-accent/30 bg-accent-subtle p-5 sm:p-6";

          return insight.href ? (
            <Link key={insight.category} href={insight.href} className={`${className} transition-colors hover:border-accent`}>
              {content}
            </Link>
          ) : (
            <div key={insight.category} className={className}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
