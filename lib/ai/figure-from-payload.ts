/**
 * Builds a chart from this turn's tool payloads (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.5).
 *
 * Pure and client-safe: no `server-only`, no Plot import — it emits plain `{label, value}` rows
 * that `components/admin/assistant-figure.tsx` hands to the same `horizontalBarSpec` the dashboard
 * uses, so an assistant chart and an Explore chart of the same numbers are the same picture.
 *
 * ## The values never come from the prose
 *
 * The same inversion as the citations in Increment 2.3: a model cannot mis-plot data it was never
 * handed. The model decides *whether* a chart is wanted (the route's `output`), and this function
 * decides what is in it, by reading the tool payload directly. Nothing here parses the answer text.
 *
 * ## It only plots shapes that are unambiguously a labelled series
 *
 * `getDistribution` gives ranked children with names and one measure; `getPeerContext` gives this
 * place against its region and the nation. Both are series by construction. A `queryDataset` result
 * is deliberately **not** plotted: choosing which column is the label and which is the measure would
 * be a guess, and a chart with the wrong column as its measure is worse than no chart — it is
 * confidently wrong and survives every audit, because all the numbers in it are real.
 *
 * When nothing matches, there is no figure and the answer stays prose.
 */

export type FigureDatum = { label: string; value: number };

export type AssistantFigure = {
  title: string;
  /** WPSAR-style Person/Place/Time line, in the register the dashboard's FigureCard uses. */
  caption: string;
  /** One-sentence takeaway, drawn from the payload — never from the model's text. */
  headline: string;
  valueSuffix: string;
  data: FigureDatum[];
  /** Which tool the figure was built from, so the UI can say where it came from. */
  from: "getDistribution" | "getPeerContext";
  /** Caveats that change how the chart must be read; rendered beneath it. */
  notes: string[];
};

/** Max bars. A ranked list longer than this stops being readable in a chat column. */
const MAX_BARS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

function suffixOf(indicator: unknown): string {
  return isRecord(indicator) && indicator.unit === "percent" ? "%" : "";
}

function labelOf(indicator: unknown): string {
  return isRecord(indicator) && typeof indicator.label === "string" ? indicator.label : "Value";
}

/**
 * A `getDistribution` payload: the ranked children of one parent.
 *
 * Small-sample children are **excluded from the chart and counted in a note**, matching
 * `lib/db/insights.ts`, which refuses to crown a leader below `MIN_LEADER_N`. A 3-profile barangay
 * at "100% accredited" plotted as the tallest bar is exactly the misreading the threshold exists to
 * prevent, and a bar chart makes it look authoritative.
 */
function fromDistribution(payload: Record<string, unknown>): AssistantFigure | null {
  const parent = payload.parent;
  const highest = payload.highest;
  if (!isRecord(parent) || !Array.isArray(highest) || highest.length === 0) return null;

  const usable = highest.filter(
    (row): row is Record<string, unknown> =>
      isRecord(row) && typeof row.geoName === "string" && typeof row.value === "number",
  );
  const plotted = usable.filter((row) => row.smallSample !== true);
  const excluded = usable.length - plotted.length;
  if (plotted.length === 0) return null;

  const counts = isRecord(payload.counts) ? payload.counts : {};
  const parentName = typeof parent.geoName === "string" ? parent.geoName : "this area";
  const label = labelOf(payload.indicator);

  return {
    title: `${label} — highest inside ${parentName}`,
    caption: `${plotted.length} of ${typeof counts.withValue === "number" ? counts.withValue : plotted.length} places with data · ${parentName} · 2025 snapshot`,
    headline: `${plotted[0].geoName as string} has the highest ${label.toLowerCase()} inside ${parentName}.`,
    valueSuffix: suffixOf(payload.indicator),
    data: plotted
      .slice(0, MAX_BARS)
      .map((row) => ({ label: row.geoName as string, value: row.value as number })),
    from: "getDistribution",
    notes: [
      ...(excluded > 0
        ? [
            `${excluded} place${excluded === 1 ? "" : "s"} with too few validated profiles ${excluded === 1 ? "is" : "are"} left out — a rate over a handful of profiles is noise, not a leader.`,
          ]
        : []),
      ...(typeof counts.missing === "number" && counts.missing > 0
        ? [
            `${counts.missing} place${counts.missing === 1 ? "" : "s"} have no value for this indicator.`,
          ]
        : []),
    ],
  };
}

/** A `getPeerContext` payload: this place against its region and the nation. */
function fromPeerContext(payload: Record<string, unknown>): AssistantFigure | null {
  const geo = payload.geo;
  const benchmark = payload.benchmark;
  if (!isRecord(geo) || !isRecord(benchmark) || typeof geo.geoName !== "string") return null;

  const data: FigureDatum[] = [];
  if (typeof benchmark.self === "number") data.push({ label: geo.geoName, value: benchmark.self });
  if (isRecord(benchmark.region) && typeof benchmark.region.value === "number") {
    data.push({
      label: typeof benchmark.region.geoName === "string" ? benchmark.region.geoName : "Region",
      value: benchmark.region.value,
    });
  }
  if (isRecord(benchmark.national) && typeof benchmark.national.value === "number") {
    data.push({ label: "Philippines", value: benchmark.national.value });
  }
  // One bar is not a comparison — the whole point of this figure is "versus what?".
  if (data.length < 2) return null;

  const label = labelOf(payload.indicator);
  const peer = isRecord(payload.peer) ? payload.peer : {};

  return {
    title: `${label} — ${geo.geoName} in context`,
    caption: `${geo.geoName} · against its region and the nation · 2025 snapshot`,
    headline:
      peer.ranked === true &&
      typeof peer.rankPosition === "number" &&
      typeof peer.nSiblings === "number"
        ? `${geo.geoName} ranks ${peer.rankPosition} of ${peer.nSiblings} ${typeof peer.siblingPlural === "string" ? peer.siblingPlural : "peers"} on ${label.toLowerCase()}.`
        : `${geo.geoName} against its region and the nation on ${label.toLowerCase()}.`,
    valueSuffix: suffixOf(payload.indicator),
    data,
    from: "getPeerContext",
    notes: Array.isArray(payload.warnings)
      ? payload.warnings.filter((w): w is string => typeof w === "string")
      : [],
  };
}

/**
 * The first payload this turn that is a plottable series, or null.
 *
 * First rather than best: the model called the tools in the order its reasoning needed, and a
 * later payload is not evidence of a better chart — picking among them would be this function
 * inventing an editorial judgement it has no basis for.
 */
export function figureFromPayloads(toolPayloads: readonly unknown[]): AssistantFigure | null {
  for (const payload of toolPayloads) {
    if (!isRecord(payload) || "error" in payload) continue;
    const figure = fromDistribution(payload) ?? fromPeerContext(payload);
    if (figure) return figure;
  }
  return null;
}
