"use client";

export type ViewMode = "chart" | "table";

const OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: "chart", label: "Chart" },
  { mode: "table", label: "Table" },
];

/** Two-option segmented control for switching a figure between chart and table. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-md border border-border p-0.5 text-xs">
      {OPTIONS.map(({ mode, label }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(mode)}
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
