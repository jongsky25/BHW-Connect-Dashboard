import Link from "next/link";
import type { InsightCard } from "@/lib/db/insights";

/** Per-category insight cards — one per area with data, replacing the single
 * rotating spotlight so patterns in every category are visible at once. */
export function InsightsGrid({ insights }: { insights: InsightCard[] }) {
  if (insights.length === 0) return null;

  return (
    <section aria-label="Insights" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </section>
  );
}
