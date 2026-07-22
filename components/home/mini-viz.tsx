/**
 * Small, non-interactive presentational visuals for the home KPI cards — one
 * per card, per the redesign plan. Pure SVG/CSS (no chart library needed for
 * shapes this simple); colors come from the app's CSS custom properties so
 * they adapt automatically in dark mode.
 */

export function StackedMiniBar({
  segments,
  ariaLabel,
  showLegend = false,
}: {
  segments: { label: string; value: number; color: string }[];
  ariaLabel: string;
  /** Render a visible color→label key beneath the bar. The bar's segments are
   * otherwise unlabeled, so multi-color mixes read as an unexplained gradient
   * (user feedback #13: "add a legend to this graph for clarity"). */
  showLegend?: boolean;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-3 w-full overflow-hidden rounded-full bg-surface">
        {total > 0 &&
          segments.map(
            (s) =>
              s.value > 0 && (
                <span
                  key={s.label}
                  style={{ width: `${(100 * s.value) / total}%`, backgroundColor: s.color }}
                />
              ),
          )}
      </div>
      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-hidden="true">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: s.color }}
              />
              <span>
                {s.label} · {s.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Donut({
  pct,
  ariaLabel,
  size = 56,
  strokeWidth = 8,
}: {
  pct: number;
  ariaLabel: string;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Compact vertical stack of thin bars, darkest-to-lightest ramp, one rung per
 * row. Each rung is labeled with its category and percentage so the ramp isn't
 * an unexplained set of colored bars (user feedback #14: "add a legend to this
 * graph for clarity"). */
export function LadderBars({
  rows,
  ariaLabel,
}: {
  rows: { label: string; pct: number }[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <div role="img" aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[1fr_auto] items-center gap-x-2">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="inline-block size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: `var(--seq-${Math.min(7, i + 1)})` }}
            />
            <span className="truncate">{r.label}</span>
          </div>
          <span className="text-xs tabular-nums text-muted">{r.pct}%</span>
          <div className="col-span-2 h-1.5 rounded-full bg-surface">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(100 * r.pct) / max}%`,
                backgroundColor: `var(--seq-${Math.min(7, i + 1)})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Semicircle gauge, value against 0..max, with an optional reference-band marker. */
export function Gauge({
  value,
  max,
  ariaLabel,
  size = 72,
  bandMin,
  bandMax,
}: {
  value: number;
  max: number;
  ariaLabel: string;
  size?: number;
  /** Optional reference band (e.g. a target range), drawn as a lighter arc segment. */
  bandMin?: number;
  bandMax?: number;
}) {
  const strokeWidth = size * 0.14;
  const r = size / 2 - strokeWidth / 2;
  const cx = size / 2;
  const cy = size / 2;
  const height = size / 2 + strokeWidth;

  // Rounded to a fixed precision: Math.cos/sin can differ in their last bit
  // between the server's and browser's JS engine builds, which otherwise
  // leaks into the `d` attribute string and trips a hydration mismatch.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const toXY = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [round(cx + r * Math.cos(rad)), round(cy - r * Math.sin(rad))];
  };
  const angleFor = (v: number) => 180 - (Math.max(0, Math.min(max, v)) / max) * 180;
  const arcPath = (fromDeg: number, toDeg: number) => {
    const [x1, y1] = toXY(fromDeg);
    const [x2, y2] = toXY(toDeg);
    const largeArc = fromDeg - toDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${round(r)} ${round(r)} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  const valueAngle = angleFor(value);
  const hasBand = bandMin !== undefined && bandMax !== undefined;

  return (
    <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={arcPath(180, 0)} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} strokeLinecap="round" />
      {hasBand && (
        <path
          d={arcPath(angleFor(bandMin), angleFor(bandMax))}
          fill="none"
          stroke="var(--seq-3)"
          strokeWidth={strokeWidth}
        />
      )}
      {value > 0 && (
        <path
          d={arcPath(180, valueAngle)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * Strip plot of a value's spread across sibling geos (one dot per geo) with an
 * accent marker for the headline value. Replaces the gauge for indicators with
 * no defensible target/max (HOME_SEARCH_REVIEW item 9 / E2: a gauge arc
 * implies a benchmark that doesn't exist; the honest comparator is the
 * observed distribution). Scale runs 0 to the largest observed value, so dot
 * positions read as proportions of the real spread, not of an invented cap.
 */
export function DotStrip({
  points,
  marker,
  ariaLabel,
}: {
  points: number[];
  marker: number;
  ariaLabel: string;
}) {
  const max = Math.max(...points, marker);
  if (max <= 0) return null;
  const left = (v: number) => `${(100 * v) / max}%`;
  const lowest = Math.min(...points);
  const highest = Math.max(...points);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {points.map((v, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
            style={{ left: left(v), backgroundColor: "var(--seq-3)" }}
          />
        ))}
        <span
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: left(marker), backgroundColor: "var(--accent)" }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[0.7rem] text-muted" aria-hidden="true">
        <span>0</span>
        <span>
          regions {lowest.toLocaleString()}–{highest.toLocaleString()}
        </span>
      </div>
      {/* Key: the visual was reported as unclear — "I don't understand the
          significance of the dots" (user feedback #12). Spell out that each
          faint dot is one region and the accent tick is this area's value. */}
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-muted" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block size-2 shrink-0 rounded-full opacity-60"
            style={{ backgroundColor: "var(--seq-3)" }}
          />
          <span>each dot = one region</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <span>this area</span>
        </li>
      </ul>
    </div>
  );
}
