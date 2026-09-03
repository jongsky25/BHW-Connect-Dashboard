"use client";

import { BarChartClient } from "@/components/charts/bar-chart-client";
import { FigureCard } from "@/components/narrative/figure-card";
import type { AssistantFigure } from "@/lib/ai/figure-from-payload";

/**
 * A chart for an assistant answer (Increment 5.5). Rendered through the same `FigureCard`
 * contract and the same `BarChartClient` the dashboard uses, so an assistant chart and an Explore
 * chart of the same numbers are the same picture — the visual counterpart of `lib/ai/tools.ts`'s
 * "the number in the answer matches the number on screen".
 *
 * The figure is built server-side from the tool payload (`figureFromPayloads`); this component
 * receives values and never text, so there is no path by which the model's prose reaches the plot.
 */
export function AssistantFigureView({ figure }: { figure: AssistantFigure }) {
  return (
    <FigureCard
      title={figure.title}
      caption={figure.caption}
      headline={figure.headline}
      technicalDetails={
        figure.notes.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {figure.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        ) : undefined
      }
    >
      <BarChartClient
        data={figure.data}
        xLabel={figure.title}
        valueSuffix={figure.valueSuffix}
        valueFormat={(n) => `${Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)}`}
      />
      <p className="mt-2 text-[11px] text-muted">
        Plotted from the <span className="font-mono">{figure.from}</span> result, not from the
        answer text.
      </p>
    </FigureCard>
  );
}
