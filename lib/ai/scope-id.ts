/**
 * Grounding-scope identifiers, and nothing else.
 *
 * `lib/ai/dataset-scope.ts` carries the scopes themselves — prompts, tool sets, dataset slugs —
 * and is `server-only`, because a tool set reaches the service-role registry. The chat launcher is
 * a client component and still has to name which scope it is asking in, so the ids live here on
 * their own, where both sides can import them.
 */

export const DATASET_SCOPE_IDS = ["bhw", "uuc-phc", "district", "facilities"] as const;

/** Which dataset a chat turn or a narrative is grounded in. */
export type DatasetScopeId = (typeof DATASET_SCOPE_IDS)[number];

export function isDatasetScopeId(value: unknown): value is DatasetScopeId {
  return typeof value === "string" && (DATASET_SCOPE_IDS as readonly string[]).includes(value);
}
