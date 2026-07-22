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

/** Per-category insight cards — one per generator with data, replacing the
 * single rotating spotlight so patterns in every category are visible at once.
 * Scoped to whichever geo level the caller passes (national on the home
 * page; region/province/etc. on place & explore pages); the generator set
 * itself is level-aware (see lib/db/insights.ts), so each level gets the
 * insights that are meaningful there. */
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

  // Group the cards by their topic/category so insights read "per group" —
  // training insights together, honorarium insights together, etc. (feedback
  // #7). Group order follows each category's first appearance, which preserves
  // the incoming score-ranked order (the most significant category leads).
  const groups: { category: string; cards: InsightCard[] }[] = [];
  for (const insight of insights) {
    const existing = groups.find((g) => g.category === insight.category);
    if (existing) existing.cards.push(insight);
    else groups.push({ category: insight.category, cards: [insight] });
  }

  return (
    <section aria-labelledby="insights-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="insights-heading" className="text-lg font-semibold tracking-tight">
          Insights
        </h2>
        <p className="text-xs text-muted">
          {LEVEL_LABEL[geoLevel]} · {geoName}
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {group.category}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((insight) => {
              const content = (
                <>
                  <p className="text-base font-medium">{insight.headline}</p>
                  <p className="mt-1 text-xs text-muted">{insight.caption}</p>
                  {insight.href && (
                    <p className="mt-2 text-xs font-medium text-accent" aria-hidden="true">
                      View the data →
                    </p>
                  )}
                </>
              );

              const className = "rounded-lg border border-accent/30 bg-accent-subtle p-5 sm:p-6";

              return insight.href ? (
                <Link
                  key={insight.id}
                  href={insight.href}
                  className={`${className} transition-colors hover:border-accent`}
                >
                  {content}
                </Link>
              ) : (
                <div key={insight.id} className={className}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
