"use client";

import { chartColorSwatches } from "@/lib/charts/palette";

/** Small swatch row for recoloring a chart's bars. Shown only in chart mode
 * (a table has no fill to recolor); selection is local, ephemeral state. */
export function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div role="group" aria-label="Chart color" className="inline-flex items-center gap-1">
      {chartColorSwatches.map((swatch) => {
        const active = value === swatch.value;
        return (
          <button
            key={swatch.value}
            type="button"
            aria-label={swatch.label}
            aria-pressed={active}
            onClick={() => onChange(swatch.value)}
            className={
              active
                ? "h-5 w-5 rounded-full ring-2 ring-offset-1 ring-accent"
                : "h-5 w-5 rounded-full ring-1 ring-border hover:ring-2 hover:ring-accent"
            }
            style={{ backgroundColor: swatch.value }}
          />
        );
      })}
    </div>
  );
}
