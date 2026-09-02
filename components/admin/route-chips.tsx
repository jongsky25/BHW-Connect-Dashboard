"use client";

import {
  ROUTE_LANES,
  ROUTE_OUTPUTS,
  type AssistantRoute,
  type RouteLane,
  type RouteOutput,
} from "@/lib/ai/route";

/**
 * The pre-filter chips (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.1): what the question was taken
 * to be about, which place it was scoped to, and what shape of answer was asked for.
 *
 * Editable, and that is the point. The route is resolved by rules first and a model only as a
 * fallback, so it will occasionally be wrong — and a wrong route that the reader cannot see is
 * worse than no route at all, because it silently changes which tools ran. Rendering it as three
 * controls makes a misroute cost one click instead of one wrong answer.
 *
 * The chips also carry the honest limits of each lane. `geographic` says containment only, because
 * `dim_geo` has no coordinates — a reader who asks for "barangays near Basilan" should learn that
 * from the interface rather than from an answer that quietly approximates it.
 */

const LANE_LABEL: Record<RouteLane, string> = {
  policy: "Policy",
  geographic: "Geographic",
  "data-quality": "Data quality",
  lineage: "Lineage",
  general: "General",
};

const LANE_HINT: Record<RouteLane, string> = {
  policy:
    "Searches the document corpus and checks whether an issuance was superseded before quoting it.",
  geographic:
    "Containment only — inside, siblings, peers. dim_geo has no coordinates, so proximity is not answerable.",
  "data-quality": "Missingness, suppression and figures that disagree.",
  lineage: "Where a figure comes from, what built it, what depends on it.",
  general: "Anything else across the registered datasets.",
};

const OUTPUT_LABEL: Record<RouteOutput, string> = {
  answer: "Answer",
  chart: "Chart",
  slide: "Slide",
  profile: "Area profile",
};

export function RouteChips({
  route,
  disabled,
  onChange,
}: {
  route: AssistantRoute;
  disabled: boolean;
  /** Called with what the reader changed. The parent re-sends the turn with it applied. */
  onChange: (next: { lane?: RouteLane; output?: RouteOutput; clearScope?: true }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs">
      <span className="text-muted">Reading this as</span>

      <label className="sr-only" htmlFor="route-lane">
        Question type
      </label>
      <select
        id="route-lane"
        value={route.lane}
        disabled={disabled}
        title={LANE_HINT[route.lane]}
        onChange={(e) => onChange({ lane: e.target.value as RouteLane })}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
      >
        {ROUTE_LANES.map((lane) => (
          <option key={lane} value={lane}>
            {LANE_LABEL[lane]}
          </option>
        ))}
      </select>

      {route.scope && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-1">
          {route.scope.geoName}
          <span className="text-muted">({route.scope.geoLevel})</span>
          <button
            type="button"
            disabled={disabled}
            // Clears the scope carried from the previous turn. If the question itself names a
            // place, the rules will resolve it again — which is correct: the reader is dropping a
            // place they inherited, not overriding one they just asked about.
            onClick={() => onChange({ clearScope: true })}
            aria-label={`Remove the ${route.scope.geoName} scope`}
            className="text-muted hover:text-foreground disabled:opacity-50"
          >
            ×
          </button>
        </span>
      )}

      <span className="text-muted">·</span>

      <label className="sr-only" htmlFor="route-output">
        Answer format
      </label>
      <select
        id="route-output"
        value={route.output}
        disabled={disabled}
        onChange={(e) => onChange({ output: e.target.value as RouteOutput })}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
      >
        {ROUTE_OUTPUTS.map((output) => (
          <option key={output} value={output}>
            {OUTPUT_LABEL[output]}
          </option>
        ))}
      </select>

      {/* Named rather than styled: a reader deciding whether to trust the lane needs to know
          whether it was matched on the question's own words or guessed by a model. */}
      <span className="text-muted">{route.confidence === "matched" ? "detected" : "inferred"}</span>

      <span className="basis-full text-muted">{LANE_HINT[route.lane]}</span>
    </div>
  );
}
