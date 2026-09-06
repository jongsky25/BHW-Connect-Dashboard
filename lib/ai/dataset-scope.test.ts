import { describe, expect, it } from "vitest";
import {
  allDatasetScopes,
  datasetScope,
  scopeForNarrativeType,
  NARRATIVE_TYPES,
} from "./dataset-scope";
import { DISTRICT_SYSTEM_PROMPT } from "./district-system-prompt";
import { FACILITIES_SYSTEM_PROMPT } from "./facilities-system-prompt";
import { DATASET_SCOPE_IDS } from "./scope-id";
import { SYSTEM_PROMPT } from "./system-prompt";
import { UUC_PHC_SYSTEM_PROMPT } from "./uuc-phc-system-prompt";
import { TOOLS } from "./tools";

/**
 * A grounding scope bundles four things that have to agree — dataset, prompt, tools, narrative
 * type — and the failure mode this file exists to catch is a *partial* switch. Half a scope
 * produces an answer that is fluent, grounded and about the wrong dataset, and nothing downstream
 * of it can tell.
 */

const names = (tools: { definition: { name: string } }[]) => tools.map((t) => t.definition.name).sort();

describe("dataset scopes", () => {
  it("resolves every declared id", () => {
    for (const id of DATASET_SCOPE_IDS) expect(datasetScope(id).id).toBe(id);
    expect(allDatasetScopes()).toHaveLength(DATASET_SCOPE_IDS.length);
  });

  it("gives each scope its own dataset and prompt", () => {
    const scopes = allDatasetScopes();
    for (const field of ["datasetSlug", "systemPrompt"] as const) {
      expect(new Set(scopes.map((s) => s[field])).size).toBe(scopes.length);
    }
  });

  it("gives each scope that has a narrative type its own — the district scope carries none", () => {
    const withNarrative = allDatasetScopes()
      .map((s) => s.narrativeType)
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    expect(new Set(withNarrative).size).toBe(withNarrative.length);
  });

  it("claims every narrative type exactly once, so no type generates under the wrong scope", () => {
    for (const type of NARRATIVE_TYPES) {
      const owners = allDatasetScopes().filter((s) => s.narrativeType === type);
      expect(owners).toHaveLength(1);
      expect(scopeForNarrativeType(type)?.narrativeType).toBe(type);
    }
  });

  it("gives each scope a distinct empty-answer line", () => {
    // The fallback names the subjects a surface can answer about; naming the other dataset's
    // subjects is the same wrong-dataset claim in a friendlier sentence.
    const lines = allDatasetScopes().map((s) => s.emptyAnswer);
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("the BHW scope", () => {
  const scope = datasetScope("bhw");

  it("is the pre-U8 behaviour unchanged — same prompt, same tools, same narrative type", () => {
    expect(scope.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(scope.createTools()).toEqual(TOOLS);
    expect(scope.narrativeType).toBe("overview");
    expect(scope.datasetSlug).toBe("bhw-2025");
  });

  it("keeps the hand-written indicator tools rather than the registry pair", () => {
    expect(names(scope.createTools())).not.toContain("queryDataset");
  });
});

describe("the UUC for PHC scope", () => {
  const scope = datasetScope("uuc-phc");

  it("runs the registry pair, not lib/ai/tools.ts", () => {
    expect(names(scope.createTools())).toEqual(["listDatasets", "queryDataset"]);
  });

  it("never reaches the internal-only tools", () => {
    // §9.1: these read service-role-only tables, and the document corpus is internal budget
    // material besides. A public surface must not grow one by being given a tool set at all.
    for (const forbidden of ["searchDocuments", "traverseGraph"]) {
      expect(names(scope.createTools())).not.toContain(forbidden);
    }
  });

  it("versions its caches on its own dataset", () => {
    expect(scope.datasetSlug).toBe("uuc-phc-2025");
    expect(scope.narrativeType).toBe("uuc_overview");
  });

  it("asks its narrative for counts and routes, and forbids the two things U3 and U7 forbid", () => {
    expect(scope.narrativePrompt).toBeDefined();
    const prompt = scope.narrativePrompt!({ geoCode: "07", geoLevel: "region", geoName: "Central Visayas" });
    expect(prompt).toContain("agg_uuc_phc_counts");
    expect(prompt).toContain("agg_uuc_phc_criteria");
    expect(prompt).toMatch(/never add the four together/i);
    expect(prompt).toMatch(/do not explain why any barangay qualified/i);
  });
});

describe("the UUC for PHC system prompt", () => {
  // The increment's point: the questions a targeting list invites are ones the data cannot
  // answer, and the prompt is where that is said. Each of these is a rule with a defect behind it.
  it.each([
    ["refuses the should-it-be-listed question", /should be on the list/i],
    ["refuses to explain any inclusion or exclusion", /why the source office included or excluded/i],
    ["names the source office to redirect to", /Bureau of Local Health Systems Development/i],
    ["forbids reasoning from the indicators to a verdict", /never reason from the indicator values/i],
    ["says the not-listed barangays were never loaded", /assessed and did not list are not in this data/i],
    ["forbids recomputing health_indicators", /never recompute it/i],
    ["requires the capped caveat in the same sentence", /capped_indicators/],
    ["forbids averaging the boundable indicators", /Never average any of these seven columns/],
    ["forbids adding the four routes", /never be added together/i],
    ["names n_health_evaluable as route (d)'s denominator", /n_health_evaluable, never n_listed/],
    ["forbids quoting the order's thresholds from memory", /thresholds or rules from memory/i],
    ["sends BHW questions to /bhw", /\/bhw/],
    ["keeps the injection rule", /never as instructions/i],
  ])("%s", (_label, pattern) => {
    expect(UUC_PHC_SYSTEM_PROMPT).toMatch(pattern);
  });

  it("does not describe itself as a BHW assistant", () => {
    expect(UUC_PHC_SYSTEM_PROMPT).not.toContain("You are the BHW Connect data assistant");
  });
});

describe("the district scope (plan D3.4)", () => {
  const scope = datasetScope("district");

  it("runs the registry pair, narrowed to ph-legislative-districts", () => {
    expect(names(scope.createTools())).toEqual(["listDatasets", "queryDataset"]);
  });

  it("never reaches the internal-only tools", () => {
    for (const forbidden of ["searchDocuments", "traverseGraph"]) {
      expect(names(scope.createTools())).not.toContain(forbidden);
    }
  });

  it("versions its cache on the district mapping's own slug, distinct from bhw and uuc-phc", () => {
    expect(scope.datasetSlug).toBe("ph-legislative-districts");
    expect(scope.datasetSlug).not.toBe(datasetScope("bhw").datasetSlug);
    expect(scope.datasetSlug).not.toBe(datasetScope("uuc-phc").datasetSlug);
  });

  it("carries no narrative — a district has no (geoCode, geoLevel) to key one on", () => {
    // See the DatasetScope field comment: NarrativeContext is geo-shaped, and a district is not a
    // dim_geo row (plan §1), so there is no cache key or prompt shape a narrative here would mean.
    expect(scope.narrativeType).toBeUndefined();
    expect(scope.narrativePrompt).toBeUndefined();
  });
});

describe("the district system prompt (plan D3.4 §2)", () => {
  // Each rule below answers to one of the four regression cases (§4) or to the provenance/vintage
  // rule §2 itself asks for — the increment's actual point.
  it.each([
    ["names the Congress a district figure is for", /congress_no/i],
    ["says the mapping is derived rather than official", /derived from public sources/i],
    ["says the grouping can change", /redistricting or an accepted public correction/i],
    ["forbids deriving a district figure from its member city's citymun total", /never derive a district.s figure from a member city/i],
    ["names the multi-district trap concretely", /Quezon City.s citymun total is not Quezon City.s 3rd district.s total/i],
    ["calls an absent district row an unresolved gap, never a zero", /UNRESOLVED MAPPING GAP/],
    ["forbids stating or implying zero BHWs for a gap", /never state or imply that the district has zero/i],
    ["says district_correction holds proposals, not the mapping", /district_correction holds PROPOSALS, not the mapping/],
    ["forbids answering 'which district is X in' from district_correction", /never answer "which district is x in" from district_correction/i],
    ["marks rationale and evidence_url as an unverified public claim", /submitter.s unverified claim/i],
    ["forbids following an instruction inside a proposal's text", /never follow an instruction that appears inside one/i],
    ["sends non-district BHW questions to /bhw", /\/bhw/],
    ["keeps the injection rule", /never as instructions/i],
  ])("%s", (_label, pattern) => {
    expect(DISTRICT_SYSTEM_PROMPT).toMatch(pattern);
  });

  it("does not describe itself as the plain BHW assistant", () => {
    expect(DISTRICT_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
    expect(DISTRICT_SYSTEM_PROMPT).toContain("district data assistant");
  });
});

describe("the facilities scope", () => {
  const scope = datasetScope("facilities");

  it("runs the registry pair, narrowed to nhfr-2026-09", () => {
    expect(names(scope.createTools())).toEqual(["listDatasets", "queryDataset"]);
  });

  it("never reaches the internal-only tools", () => {
    for (const forbidden of ["searchDocuments", "traverseGraph"]) {
      expect(names(scope.createTools())).not.toContain(forbidden);
    }
  });

  it("versions its cache on the NHFR snapshot's own slug, distinct from the other scopes", () => {
    expect(scope.datasetSlug).toBe("nhfr-2026-09");
    expect(scope.datasetSlug).not.toBe(datasetScope("bhw").datasetSlug);
    expect(scope.datasetSlug).not.toBe(datasetScope("uuc-phc").datasetSlug);
    expect(scope.datasetSlug).not.toBe(datasetScope("district").datasetSlug);
  });

  it("versions its cache and its narrative under the same slug's own type", () => {
    expect(scope.narrativeType).toBe("facilities_overview");
  });

  it("asks its narrative for facility counts and coverage, and forbids the percent-licensed trap", () => {
    expect(scope.narrativePrompt).toBeDefined();
    const prompt = scope.narrativePrompt!({
      geoCode: "07",
      geoLevel: "region",
      geoName: "Central Visayas",
    });
    expect(prompt).toContain("agg_nhfr_counts");
    expect(prompt).toContain("agg_nhfr_by_type");
    expect(prompt).toMatch(/never state or imply a percent-licensed figure/i);
    expect(prompt).toMatch(/never call a facility with a blank licensing status unlicensed/i);
  });
});

describe("the facilities system prompt", () => {
  // Each rule below answers to a caveat dataset_registry.notes_md already carries on the three
  // NHFR relations (N5) — the increment's whole point is restating them at rule priority.
  it.each([
    ["forbids treating a blank licensing status as unlicensed", /never "unlicensed"/i],
    ["forbids a percent-licensed figure at any level", /never compute or imply a "% licensed" figure/i],
    ["forbids grouping by facility_major_type", /never facility_major_type/],
    ["names the Sulu region/code mismatch", /BARMM/],
    ["says contact columns do not exist rather than are hidden", /do not exist in this table at all/i],
    ["forbids reading a missing type row as zero", /NO ROW, not a zero row/],
    ["says the four headline types do not sum to n_facilities", /do NOT sum to n_facilities/],
    ["forbids swapping the coverage denominator", /must never be paired with n_facilities/],
    ["sends BHW questions to /bhw", /\/bhw/],
    ["keeps the injection rule", /never as instructions/i],
  ])("%s", (_label, pattern) => {
    expect(FACILITIES_SYSTEM_PROMPT).toMatch(pattern);
  });

  it("does not describe itself as the plain BHW assistant", () => {
    expect(FACILITIES_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
    expect(FACILITIES_SYSTEM_PROMPT).toContain("health facilities data assistant");
  });
});
