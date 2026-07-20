/**
 * Small, non-interactive presentational visuals for the home KPI cards — one
 * per card, per the redesign plan. Pure SVG/CSS (no chart library needed for
 * shapes this simple); colors come from the app's CSS custom properties so
 * they adapt automatically in dark mode.
 */

export function StackedMiniBar({
  segments,
  ariaLabel,
}: {
  segments: { label: string; value: number; color: string }[];
  ariaLabel: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
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

/** Compact vertical stack of thin bars, darkest-to-lightest ramp, one rung per row. */
export function LadderBars({
  rows,
  ariaLabel,
}: {
  rows: { label: string; pct: number }[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <div role="img" aria-label={ariaLabel} className="flex flex-col gap-0.5">
      {rows.map((r, i) => (
        <div key={r.label} className="h-1.5 rounded-full bg-surface">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(100 * r.pct) / max}%`,
              backgroundColor: `var(--seq-${Math.min(7, i + 1)})`,
            }}
          />
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
