import { z } from "zod";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";

/**
 * The assistant's pre-filter (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.1): what *kind* of concern
 * a question is, what geography it is about, and what shape of answer it wants — decided before
 * the tool loop runs, rendered as editable chips, and fed back into the system prompt.
 *
 * This module is deliberately pure and free of `server-only`, for two reasons. The rules are the
 * half worth unit-testing exhaustively, and `components/admin/route-chips.tsx` is a client
 * component that needs these types — a `server-only` import in its module graph is a build error
 * waiting to happen even though `import type` erases. The I/O half lives in `route-request.ts`.
 *
 * The route is not decoration. `routeSystemFacts` turns it into instructions that change which
 * tools the model reaches for, which is the whole reason it is worth computing.
 */

export const ROUTE_LANES = ["policy", "geographic", "data-quality", "lineage", "general"] as const;
export type RouteLane = (typeof ROUTE_LANES)[number];

export const ROUTE_OUTPUTS = ["answer", "chart", "slide", "profile"] as const;
export type RouteOutput = (typeof ROUTE_OUTPUTS)[number];

export type RouteScope = { geoCode: string; geoLevel: GeoLevel; geoName: string };

export type AssistantRoute = {
  lane: RouteLane;
  scope: RouteScope | null;
  output: RouteOutput;
  /** `matched` = resolved by the deterministic rules; `inferred` = a model call, or the fallback. */
  confidence: "matched" | "inferred";
};

export const routeScopeSchema = z.object({
  geoCode: z.string().min(1).max(20),
  geoLevel: z.enum(GEO_LEVELS),
  geoName: z.string().min(1).max(200),
});

/**
 * What a reader may pin by editing a chip. Both fields are optional, so editing one chip does not
 * require the browser to restate the other.
 *
 * **Scope is deliberately not pinnable.** It is carried between turns instead (`carriedScope` in
 * `route-request.ts`), and the difference is not cosmetic: a pin overrides, and a scope that
 * overrides is a bug. Ask "accreditation in Basilan" and then "accreditation in Cebu", and a
 * pinned Basilan would win over the Cebu the rules just resolved — answering confidently about
 * the wrong province, with figures that audit perfectly clean. A carried scope only fills a gap
 * the question itself left, so a question that names a place always wins.
 */
export const pinnedRouteSchema = z.object({
  lane: z.enum(ROUTE_LANES).optional(),
  output: z.enum(ROUTE_OUTPUTS).optional(),
});
export type PinnedRoute = z.infer<typeof pinnedRouteSchema>;

/** Where an unresolvable question lands. `general` + `answer` is exactly today's behaviour, so the
 * fallback is "the assistant as it was", never a wrong lane confidently applied. */
export const DEFAULT_ROUTE: AssistantRoute = {
  lane: "general",
  scope: null,
  output: "answer",
  confidence: "inferred",
};

// --- Lane rules -------------------------------------------------------------------------------
//
// Ordered by priority, first match wins. Policy outranks geography because "is the GIDA circular
// still in force in Basilan" is a supersession question that happens to name a place — routing it
// geographically would answer it from `dim_geo` and never check whether the circular was replaced.
// The scope is still resolved for it (scope is independent of lane), so nothing is lost.

const LANE_PATTERNS: readonly { lane: RouteLane; pattern: RegExp }[] = [
  {
    lane: "policy",
    pattern:
      /\b(circular|memorand\w*|jmc|dc no|ao no|administrative order|republic act|ra \d|issuance|guideline|in force|superseded?|repealed|magna carta|policy)\b/i,
  },
  {
    lane: "lineage",
    pattern:
      /\b(where (?:does|did) .{0,60}come from|what built|which migration|lineage|provenance|derived from|how (?:is|was) .{0,60}(?:computed|calculated|built)|what would break)\b/i,
  },
  {
    lane: "data-quality",
    pattern:
      /\b(missing|missingness|completeness|data quality|coverage gap|not encoded|unencoded|suppress\w*|contradict\w*|disagree\w*)\b/i,
  },
];

/**
 * Words that mean this is a question about the data even when no place and no policy is named, so
 * "how many BHWs are accredited?" resolves to `general` for free rather than spending a routing
 * call. Doubles as the guard in `pickScope` below — see there for why that matters.
 */
const DOMAIN_WORDS =
  /\b(bhw|barangay health worker|accredit\w*|honorari\w*|training|trained|demographic\w*|profil\w*|poverty|population|household\w*|coverage|uuc|phc|certif\w*|cohort|workload|income class|indicator|dataset|table)\b/i;

// --- Output rules -----------------------------------------------------------------------------
//
// Absence of a keyword means `answer`, never "unresolved". A question that does not ask for a
// chart wants prose, and treating that as ambiguous would spend a provider call on every plain
// question — which is the cost this whole rules pass exists to avoid.

const OUTPUT_PATTERNS: readonly { output: RouteOutput; pattern: RegExp }[] = [
  {
    output: "profile",
    pattern:
      /\b(profile|everything (?:about|on|for)|all (?:the )?data (?:on|for|about)|full picture)\b/i,
  },
  { output: "slide", pattern: /\b(slide|slides|present\w*|deck|briefing|powerpoint|pptx)\b/i },
  { output: "chart", pattern: /\b(chart|graph|plot|visuali[sz]\w*|bar chart|figure)\b/i },
];

/** Lowercase, strip diacritics, collapse punctuation to spaces — so "Basilán," matches "basilan". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectLane(question: string): RouteLane | null {
  for (const { lane, pattern } of LANE_PATTERNS) {
    if (pattern.test(question)) return lane;
  }
  return null;
}

export function detectOutput(question: string): RouteOutput {
  for (const { output, pattern } of OUTPUT_PATTERNS) {
    if (pattern.test(question)) return output;
  }
  return "answer";
}

/** Minimum token length considered distinctive enough to require in the question. "del", "sur",
 * "de" and "city" are below it and carry no identifying weight on their own. */
const SCOPE_TOKEN_MIN_LENGTH = 4;

/**
 * Choose the geography a question is actually about from `searchGeo`'s ranked hits.
 *
 * `searchGeo` is deliberately fuzzy — it exists so a misspelled place still resolves — which means
 * its top hit for "training coverage nationally" can be a barangay called TRAINING. Taking hit[0]
 * would silently scope a national question to one barangay, and a wrong scope is worse than none:
 * it is invisible in the answer and the figures still audit clean.
 *
 * So a hit is accepted only when every distinctive token of its name is present in the question,
 * and rejected when the only thing making it match is a word from the domain vocabulary. Both
 * checks are needed: the first alone accepts TRAINING, the second alone accepts any single-token
 * name that appears nowhere in the question.
 */
export function pickScope(
  question: string,
  geoHits: readonly { geoCode: string; geoLevel: GeoLevel; geoName: string }[],
): RouteScope | null {
  const haystack = ` ${normalise(question)} `;

  for (const hit of geoHits) {
    const tokens = normalise(hit.geoName)
      .split(" ")
      .filter((t) => t.length >= SCOPE_TOKEN_MIN_LENGTH);
    if (tokens.length === 0) continue;
    if (!tokens.every((t) => haystack.includes(` ${t} `))) continue;
    // Every distinctive token is a domain word — the name matched the vocabulary, not the place.
    if (tokens.every((t) => DOMAIN_WORDS.test(t))) continue;

    return { geoCode: hit.geoCode, geoLevel: hit.geoLevel, geoName: hit.geoName };
  }
  return null;
}

/**
 * The deterministic route. Returns `null` only when the question carries no signal at all — no
 * policy/lineage/quality vocabulary, no resolvable place, and no domain word — which is the one
 * case worth spending a provider call on (`routeRequest` in `route-request.ts`).
 */
export function routeByRules(
  question: string,
  geoHits: readonly { geoCode: string; geoLevel: GeoLevel; geoName: string }[],
): AssistantRoute | null {
  const scope = pickScope(question, geoHits);
  const output = detectOutput(question);

  const lane =
    detectLane(question) ?? (scope ? "geographic" : DOMAIN_WORDS.test(question) ? "general" : null);
  if (lane === null) return null;

  return { lane, scope, output, confidence: "matched" };
}

/** Apply a reader's pinned fields over a computed route. A pinned field is authoritative — which
 * is why `scope` is not among them; see `pinnedRouteSchema`. */
export function applyPinned(
  route: AssistantRoute,
  pinned: PinnedRoute | undefined,
): AssistantRoute {
  if (!pinned) return route;
  return {
    lane: pinned.lane ?? route.lane,
    scope: route.scope,
    output: pinned.output ?? route.output,
    confidence: route.confidence,
  };
}

/**
 * Fill an unresolved scope from the previous turn's. This is what makes "and its training
 * coverage?" work: the follow-up names no place, so nothing was resolved for it, and the place
 * from the turn before is the only sensible reading.
 *
 * Strictly a fallback. When the question resolved its own scope, that wins — see
 * `pinnedRouteSchema` for why the reverse would be a silent wrong-place answer.
 */
export function applyCarriedScope(
  route: AssistantRoute,
  carried: RouteScope | null | undefined,
): AssistantRoute {
  if (route.scope || !carried) return route;
  return { ...route, scope: carried };
}

/**
 * The route rendered as instructions for the system prompt.
 *
 * Returned as a string to concatenate into the SINGLE system message, never as a second one:
 * `lib/ai/providers/gemini.ts` builds `systemInstruction` from the first system-role message and
 * silently drops every later one, so a second system message would be invisible on the provider
 * the cascade reaches first.
 */
export function routeSystemFacts(route: AssistantRoute): string {
  const lines: string[] = [];

  if (route.scope) {
    lines.push(
      `The question is scoped to ${route.scope.geoName} (geo_code ${route.scope.geoCode}, level ${route.scope.geoLevel}). Use that geo_code directly — do not call searchGeo to look it up again.`,
    );
  }

  switch (route.lane) {
    case "policy":
      lines.push(
        "This is a POLICY question. Call searchDocuments before answering, and walk `supersedes` with traverseGraph before naming any issuance as current — the words a search matches are usually the superseded ones (rule 9b).",
      );
      break;
    case "lineage":
      lines.push(
        "This is a PROVENANCE question. Use traverseGraph on the lineage graph with direction `both`, and quote the path with the file or slide each step cites.",
      );
      break;
    case "data-quality":
      lines.push(
        "This is a DATA-QUALITY question. Prefer getDataCompleteness and the quality tables, and report suppression and coverage caveats as the finding rather than as a footnote.",
      );
      break;
    case "geographic":
      lines.push(
        "This is a GEOGRAPHIC question. dim_geo holds containment only — there are no coordinates, so questions about what is *near* or *adjacent to* a place cannot be answered; say so plainly rather than approximating. Subtree and sibling questions are traverseGraph walks from the scoped geo_code.",
      );
      break;
    case "general":
      break;
  }

  switch (route.output) {
    case "chart":
      lines.push(
        "The reader asked for a CHART. Return the figures as a short labelled series (one label and one value per line) alongside the prose, so the values can be plotted.",
      );
      break;
    case "slide":
      lines.push(
        "The reader asked for a SLIDE. Lead with a single headline sentence, then at most five supporting lines. Nothing that would not fit on one slide.",
      );
      break;
    case "profile":
      lines.push(
        "The reader asked for a PROFILE of one place: cover every dataset that has data for it, and say explicitly which ones do not.",
      );
      break;
    case "answer":
      break;
  }

  return lines.length === 0
    ? ""
    : `\n\nFor this question:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
