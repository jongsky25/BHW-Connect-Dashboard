"use client";

export type AmountPeriod = "monthly" | "quarterly" | "annual";

/** Months in one period — used to scale a monthly figure up to the chosen period. */
export const PERIOD_MONTHS: Record<AmountPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/** Singular noun for a period, e.g. "per month" / "per quarter" / "per year". */
export const PERIOD_NOUN: Record<AmountPeriod, string> = {
  monthly: "month",
  quarterly: "quarter",
  annual: "year",
};

const OPTIONS: { period: AmountPeriod; label: string }[] = [
  { period: "monthly", label: "Monthly" },
  { period: "quarterly", label: "Quarterly" },
  { period: "annual", label: "Annual" },
];

/**
 * Three-option segmented control for switching an amount figure between
 * monthly, quarterly, and annual totals. Mirrors ViewToggle's styling.
 */
export function PeriodToggle({
  value,
  onChange,
}: {
  value: AmountPeriod;
  onChange: (period: AmountPeriod) => void;
}) {
  return (
    <div role="tablist" aria-label="Amount period" className="inline-flex rounded-md border border-border p-0.5 text-xs">
      {OPTIONS.map(({ period, label }) => {
        const active = value === period;
        return (
          <button
            key={period}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(period)}
            className={
              active
                ? "rounded px-2 py-1 font-medium bg-accent text-accent-foreground"
                : "rounded px-2 py-1 text-muted hover:text-foreground"
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
