import type { AssistantRoute } from "./route";

/**
 * Follow-up questions offered under an answer (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.2).
 *
 * Derived from this turn's tool payloads, **deterministically and with no provider call**. Asking
 * the model for suggestions would be the obvious build and the wrong one twice over: it spends
 * free-tier quota on decoration (`lib/ai/quota.ts` seeds Gemini at 10 requests/minute), and a
 * suggested question is a promise that the assistant can answer it — a model inventing "compare
 * this to 2024" would offer a question no registered dataset can serve.
 *
 * So a template fires only when the payload carries what the template names. Every suggestion is
 * therefore about a geography, a table or a document that was actually returned this turn, which
 * is the same principle as the citations in 2.3: the evidence comes from the retrieval, never from
 * the prose.
 */

export const MAX_FOLLOW_UPS = 3;

/** `queryDataset` results carry the table they read and the grain it was read at. */
function tableOf(payload: Record<string, unknown>): string | null {
  return typeof payload.table === "string" && typeof payload.grain === "string"
    ? payload.table
    : null;
}

/** The indicator tools return the resolved geography alongside their figures. */
function geoNameOf(payload: Record<string, unknown>): string | null {
  return typeof payload.geoName === "string" &&
    typeof payload.geoCode === "string" &&
    typeof payload.geoLevel === "string"
    ? payload.geoName
    : null;
}

/** True when `searchDocuments` returned at least one passage — same shape `collectCitations` reads. */
function hasDocumentHit(payload: Record<string, unknown>): boolean {
  const results = payload.results;
  return (
    Array.isArray(results) &&
    results.some(
      (hit) =>
        Boolean(hit) &&
        typeof hit === "object" &&
        typeof (hit as Record<string, unknown>).chunkId === "number" &&
        typeof (hit as Record<string, unknown>).citation === "string",
    )
  );
}

/**
 * `agg_peer_ranks` stops at city/municipality and has no row for the national level, so a peer
 * question is only worth offering in between. Offering one that is guaranteed to come back
 * "not ranked at this level" trains the reader to ignore the suggestions.
 */
const PEER_RANKED_LEVELS = new Set(["region", "province", "citymun"]);

export function suggestFollowUps(
  route: AssistantRoute,
  toolPayloads: readonly unknown[],
): string[] {
  const objects = toolPayloads.filter(
    (p): p is Record<string, unknown> => Boolean(p) && typeof p === "object",
  );
  // A payload carrying an `error` describes a refused call, not a result — nothing in it is a fact
  // to build a follow-up on.
  const payloads = objects.filter((p) => !("error" in p));

  const suggestions: string[] = [];
  const add = (question: string) => {
    if (!suggestions.includes(question)) suggestions.push(question);
  };

  const geoName = route.scope?.geoName ?? payloads.map(geoNameOf).find(Boolean) ?? null;
  const geoLevel = route.scope?.geoLevel ?? null;

  if (geoName) {
    if (!geoLevel || PEER_RANKED_LEVELS.has(geoLevel)) {
      add(`How does ${geoName} compare with its peers?`);
    }
    if (geoLevel !== "barangay") {
      add(`Which places inside ${geoName} are furthest below it?`);
    }
  }

  if (payloads.some(hasDocumentHit)) {
    add("Was any issuance behind this superseded?");
  }

  const table = payloads.map(tableOf).find(Boolean);
  if (table) {
    add(`Where does ${table} come from?`);
  }

  // Only when the turn produced nothing else to build on — a bare prompt to narrow the question is
  // better than no affordance, but it should never crowd out a grounded one.
  if (suggestions.length === 0 && route.lane === "general") {
    add("Which datasets can you reach for this?");
  }

  return suggestions.slice(0, MAX_FOLLOW_UPS);
}
