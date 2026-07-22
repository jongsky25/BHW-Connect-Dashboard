import Link from "next/link";
import { regionalSpread } from "@/lib/analysis/regional-spread";
import type { ProfilingStatusChild } from "@/lib/db/profiling-status";

/** How many areas to name at each end of the ranking. */
const TOP_N = 3;

function pctLabel(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

function Row({ child }: { child: ProfilingStatusChild }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <Link
        href={`/profiling-status/${child.geoLevel}/${child.geoCode}`}
        className="hover:text-accent hover:underline"
      >
        {child.geoName}
      </Link>
      <span className="tabular-nums font-medium">{pctLabel(child.certify.pct)}</span>
    </li>
  );
}

/**
 * A neutral leaderboard of the child areas by certification progress — who is furthest along and
 * who has the most still to do. Framed as facts about where the work stands, not a merit ranking
 * (matching the `leaderLabel`/`MIN_LEADER_N` conventions elsewhere). A server component fed by the
 * `children` the page already loaded; renders nothing until there is real spread to show.
 */
export function AreaRanking({
  heading,
  items,
}: {
  /** The child level being ranked, e.g. "Regions" / "Provinces". */
  heading: string;
  items: ProfilingStatusChild[];
}) {
  // Need at least a few areas, and a real spread, or a ranking is noise.
  const ranked = items
    .filter((c) => c.certify.pct !== null)
    .sort((a, b) => (b.certify.pct ?? 0) - (a.certify.pct ?? 0));
  if (ranked.length < 3) return null;

  const spread = regionalSpread(ranked, (c) => c.certify.pct);
  if (!spread || spread.max === spread.min) return null;

  const leaders = ranked.slice(0, Math.min(TOP_N, ranked.length));
  const laggards = ranked
    .slice(Math.max(ranked.length - TOP_N, leaders.length))
    .reverse();

  return (
    <section
      aria-label={`${heading} ranked by certification`}
      className="rounded-lg border border-border bg-background p-5 sm:p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Furthest along vs. most still to do</h2>
        <span className="text-xs text-muted">
          {heading}: {spread.min}%–{spread.max}% certified
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Furthest along</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {leaders.map((c) => (
              <Row key={c.geoCode} child={c} />
            ))}
          </ol>
        </div>
        {laggards.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Most still to do
            </p>
            <ol className="mt-2 flex flex-col gap-1.5">
              {laggards.map((c) => (
                <Row key={c.geoCode} child={c} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
