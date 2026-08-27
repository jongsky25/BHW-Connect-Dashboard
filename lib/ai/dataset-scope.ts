import "server-only";
import { DATASET_SLUGS } from "@/lib/db/dataset";
import type { GeoLevel } from "@/lib/filters/schema";
import { createDatasetTools } from "./dataset-tools";
import { DATASET_SCOPE_IDS, type DatasetScopeId } from "./scope-id";
import { SYSTEM_PROMPT } from "./system-prompt";
import { TOOLS, type Tool } from "./tools";
import { UUC_PHC_SYSTEM_PROMPT } from "./uuc-phc-system-prompt";

/**
 * One grounding scope: which dataset a chat turn or a narrative is about, and everything that has
 * to agree with that answer — the tool set, the system prompt, the cache version, the narrative
 * type (docs/UUC_PHC_2025_PLAN.md §9 U8; §8 defects 2 and 3).
 *
 * **Why these live together rather than as four parameters.** The failure this module exists to
 * prevent is a *partial* switch: the UUC tools with the BHW prompt, or the right prompt with the
 * BHW cache key. Each of those produces an answer that is fluent, passes the numeric audit, and is
 * about the wrong dataset — and nothing in the UI would reveal it. Bundling them means a caller
 * picks a scope, not a set of settings it could get half right.
 *
 * `datasetSlug` is load-bearing twice over: it versions the caches (`dim_dataset.last_updated_at`
 * for *that* dataset, so a UUC republication invalidates UUC answers and a BHW ingestion does not)
 * and it scopes the registry tools to that dataset's relations.
 */

export const NARRATIVE_TYPES = ["overview", "uuc_overview"] as const;

/**
 * The `narrative_type` half of `ai_narrative_cache`'s key. It was already in the key and already
 * a free extension point (`'overview'` was the only value), which is why §8 defect 2 costs one
 * enum value rather than a migration: `data_version|geo|narrative_type` separates a UUC insight
 * for Region VII from the BHW insight for Region VII the moment a second value exists.
 */
export type NarrativeType = (typeof NARRATIVE_TYPES)[number];

export type NarrativeContext = { geoCode: string; geoLevel: GeoLevel; geoName: string };

export type DatasetScope = {
  id: DatasetScopeId;
  /** `dim_dataset.slug`. Versions this scope's caches, and scopes its registry tools. */
  datasetSlug: string;
  systemPrompt: string;
  /** Built per call, not held: the registry tools read `dataset_registry` at execute time. */
  createTools: () => Tool[];
  narrativeType: NarrativeType;
  narrativePrompt: (context: NarrativeContext) => string;
  /**
   * What the chat says when the audit left nothing standing. Scope-specific because it names the
   * subjects this surface can actually answer about, and naming the other dataset's subjects is
   * the same wrong-dataset claim in a friendlier sentence.
   */
  emptyAnswer: string;
};

/**
 * The BHW census scope — the behaviour every existing surface already has, moved here unchanged.
 * The hand-written indicator tools stay: they return the same shaped figures the dashboard
 * renders, which is what keeps "the number in the answer matches the number on screen" true, and
 * the registry path would answer the same questions by a different route.
 */
const BHW_SCOPE: DatasetScope = {
  id: "bhw",
  datasetSlug: DATASET_SLUGS.profiled,
  systemPrompt: SYSTEM_PROMPT,
  createTools: () => TOOLS,
  narrativeType: "overview",
  narrativePrompt: ({ geoCode, geoLevel, geoName }) =>
    `Write a short (2-4 sentence) narrative summarizing BHW figures for ${geoName} (geo_code ${geoCode}, geoLevel ${geoLevel}). Call getIndicatorByGeo for the accreditation and demographics indicators, and check getTrainingCoverage/getHonorariumStats for anything worth mentioning. Lead with the Total BHWs vs. Validated profiles framing, then one or two more findings from the data. When you cite a headline figure, situate it against this place's region and the nation (call getIndicatorByGeo again with the region's or the national 'PH' geo_code), note where it stands among same-level places if the data you have shows that, and always state the N (validated profiles) behind any percentage, flagging plainly when N is small enough that the figure could swing widely. One paragraph, plain language, WPSAR tone.`,
  emptyAnswer:
    "I couldn't find a fully grounded answer to that in the dataset — try asking about a specific place or indicator (accreditation, demographics, training, honorarium, or service years).",
};

/**
 * The UUC for PHC scope. Its tools are the registry pair at `public` exposure, narrowed to this
 * dataset's own relations — the plan's "no new tool code: the model reaches this dataset through
 * `queryDataset` over the tables U5 registers".
 *
 * **Why the scope is narrowed rather than left at plain `public` exposure.** `createDatasetTools`
 * with no slug scope hands over all 26 public relations, the BHW aggregates included. Nothing
 * about that is unsafe — every one of them is a table `anon` can already read — but it would make
 * the two sections answer each other's questions by construction, which is the same confusion §8
 * defects 2 and 3 describe, arriving through the front door instead of through a cache. A reader
 * on a targeting list of barangays asking about accreditation should be sent to `/bhw`, not
 * quietly answered here from a table this section never renders.
 *
 * `dim_geo` and `dim_dataset` stay in scope because they carry no `dataset_slug`: they are the
 * coordinate system every dataset is expressed in rather than datasets of their own. `dim_geo` is
 * what makes the plan's second Verify case answerable at all — telling "that barangay is not on
 * the 2025 list" apart from "there is no such barangay" needs a source of barangays that is not
 * the list itself.
 *
 * **On guardrail 5** (`AI_ASSISTANT_PLAN.md` §9: public tools touch only the `agg_*`/`dim_*`
 * layer): this scope reaches `fact_uuc_phc_barangay` and `fact_uuc_phc_indicators`. That is not a
 * relaxation of the guardrail — the guardrail is implemented as the registry's `exposure` column,
 * and U5 registered both of those `public` on their merits. They are a published list of *places*
 * with no person-level rows, already public-read to `anon`, and already rendered in full on the
 * city/municipality page. The suppression concern the guardrail exists for (`fact_bhw_raw`, 270,917
 * people) does not arise, and `fact_bhw_raw` remains unregistered and unreachable from here.
 */
const UUC_PHC_SCOPE: DatasetScope = {
  id: "uuc-phc",
  datasetSlug: DATASET_SLUGS.uucPhc,
  systemPrompt: UUC_PHC_SYSTEM_PROMPT,
  createTools: () => createDatasetTools("public", [DATASET_SLUGS.uucPhc]),
  narrativeType: "uuc_overview",
  narrativePrompt: ({ geoCode, geoLevel, geoName }) =>
    `Write a short (2-4 sentence) summary of where ${geoName} (geo_code ${geoCode}, geoLevel ${geoLevel}) stands on the 2025 UUC for PHC list. Call listDatasets first to read the dictionaries, then queryDataset on agg_uuc_phc_counts for this area's n_listed and n_barangays, and on agg_uuc_phc_criteria for the qualifying routes. Lead with the count against its barangay denominator — how many of this area's barangays are on the list, out of how many it has. Then add at most two more grounded findings: which qualifying route the most barangays here came in on, and how this area's share compares to the national row (query geo_code 'PH' at geo_level 'national' for it). Report each route as its own share of its own denominator and never add the four together — they overlap. If nothing in this area is listed, say that plainly: the list is national and complete as published, so a zero is a result rather than missing data. Do not explain why any barangay qualified beyond the recorded route counts, and do not quote the order's thresholds. One paragraph, plain language, WPSAR tone.`,
  emptyAnswer:
    "I couldn't find a fully grounded answer to that in this list — try asking which barangays in a place are on the 2025 list, or how many of them came in on each qualifying route. Whether a barangay should be on the list is the source office's to answer, not this dashboard's.",
};

const SCOPES: Record<DatasetScopeId, DatasetScope> = {
  bhw: BHW_SCOPE,
  "uuc-phc": UUC_PHC_SCOPE,
};

export function datasetScope(id: DatasetScopeId): DatasetScope {
  return SCOPES[id];
}

/** Every scope, for callers that must act on all of them — the answer-bank refresh, and tests. */
export function allDatasetScopes(): DatasetScope[] {
  return DATASET_SCOPE_IDS.map(datasetScope);
}

/** The scope a `narrative_type` belongs to. Null for a type no scope claims. */
export function scopeForNarrativeType(narrativeType: NarrativeType): DatasetScope | null {
  return allDatasetScopes().find((s) => s.narrativeType === narrativeType) ?? null;
}
