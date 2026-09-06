import "server-only";
import { DATASET_SLUGS } from "@/lib/db/dataset";
import type { GeoLevel } from "@/lib/filters/schema";
import { createDatasetTools } from "./dataset-tools";
import { DISTRICT_SYSTEM_PROMPT } from "./district-system-prompt";
import { FACILITIES_SYSTEM_PROMPT } from "./facilities-system-prompt";
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

export const NARRATIVE_TYPES = ["overview", "uuc_overview", "facilities_overview"] as const;

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
  /**
   * Both omitted together for a scope with no geo-shaped narrative to generate. The district scope
   * is the case: `NarrativeContext` is keyed on `(geoCode, geoLevel)`, and a district is neither —
   * it has no `dim_geo` row of its own (plan §1) — so there is no cache key or prompt shape that
   * would mean anything for one. Omitting both is the honest state, not a stub to fill in later.
   */
  narrativeType?: NarrativeType;
  narrativePrompt?: (context: NarrativeContext) => string;
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

/**
 * The legislative-district scope (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.4). The registry pair,
 * narrowed to `ph-legislative-districts` — `agg_bhw_by_district`, `dim_legislative_district`,
 * `geo_district_map`, `district_representative` and `district_correction` all carry that slug
 * (D1.6, D2.6, D3.4 §1), so this is the whole tool set: no dataset-specific code, per §1's own
 * framing of what the registry is for.
 *
 * **`datasetSlug` is what makes D3.4 §3 true.** `lib/db/district-correction-changelog.ts` has
 * called `bumpDatasetVersion(DATASET_SLUGS.legislativeDistricts)` on every accepted correction
 * since D2.6, with nothing to invalidate — no scope was keyed on this slug, so `ai_ask_cache` held
 * no district answers for the bump to expire. This scope is that missing piece: from here on, an
 * accepted correction changes `dim_dataset.last_updated_at` for this slug, which changes this
 * scope's `dataVersion` and therefore every cache key `app/api/ai/chat/route.ts` builds for it —
 * invalidating district answers and, because no other scope shares this slug, nothing else.
 *
 * No narrative type: see the field comment on `DatasetScope`.
 */
const DISTRICT_SCOPE: DatasetScope = {
  id: "district",
  datasetSlug: DATASET_SLUGS.legislativeDistricts,
  systemPrompt: DISTRICT_SYSTEM_PROMPT,
  createTools: () => createDatasetTools("public", [DATASET_SLUGS.legislativeDistricts]),
  emptyAnswer:
    "I couldn't find a fully grounded answer to that in the district mapping — try asking about a specific district by name, or which district a city, municipality or barangay belongs to.",
};

/**
 * The health-facilities scope (docs/NHFR_2026_PLAN.md §Deferred). The registry pair, narrowed to
 * `nhfr-2026-09` — `fact_nhfr_facility`, `agg_nhfr_counts` and `agg_nhfr_by_type` all carry that
 * slug (N5) — so this is the whole tool set: no dataset-specific code, on the district scope's
 * precedent immediately above.
 *
 * `narrativeType` pays back the other half of the deferred list the chat-only scope above left
 * open (docs/DECISIONS.md, 2026-09-05): the AI insight slot for `/facilities`'s area pages. It
 * was always a field addition rather than a rewrite — see the `DatasetScope` field comment.
 */
const FACILITIES_SCOPE: DatasetScope = {
  id: "facilities",
  datasetSlug: DATASET_SLUGS.nhfr,
  systemPrompt: FACILITIES_SYSTEM_PROMPT,
  createTools: () => createDatasetTools("public", [DATASET_SLUGS.nhfr]),
  narrativeType: "facilities_overview",
  narrativePrompt: ({ geoCode, geoLevel, geoName }) =>
    `Write a short (2-4 sentence) summary of the health facilities registered in ${geoName} (geo_code ${geoCode}, geoLevel ${geoLevel}) per the DOH National Health Facility Registry. Call listDatasets first to read the dictionaries, then queryDataset on agg_nhfr_counts for this area's n_facilities and barangay coverage, and on agg_nhfr_by_type for the facility types present here. Lead with the facility count, then the barangay coverage — how many of this area's barangays have at least one facility, out of how many it has. Add at most one more grounded finding from agg_nhfr_by_type: which facility type is most common here, remembering a type absent from an area has no row rather than a zero. Never state or imply a percent-licensed figure, and never call a facility with a blank licensing status unlicensed — most facilities here carry no licensing status at all, and that is a gap in what was recorded, not a finding about the facility. One paragraph, plain language, WPSAR tone.`,
  emptyAnswer:
    "I couldn't find a fully grounded answer to that in the registry — try asking about facility counts, types, ownership, or how many of an area's barangays have one. Whether a specific facility is properly licensed is a question for the DOH regional office, not this dashboard.",
};

const SCOPES: Record<DatasetScopeId, DatasetScope> = {
  bhw: BHW_SCOPE,
  "uuc-phc": UUC_PHC_SCOPE,
  district: DISTRICT_SCOPE,
  facilities: FACILITIES_SCOPE,
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
