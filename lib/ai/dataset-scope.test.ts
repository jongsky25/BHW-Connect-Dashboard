import { describe, expect, it } from "vitest";
import {
  allDatasetScopes,
  datasetScope,
  scopeForNarrativeType,
  NARRATIVE_TYPES,
} from "./dataset-scope";
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

  it("gives each scope its own dataset, prompt and narrative type", () => {
    const scopes = allDatasetScopes();
    for (const field of ["datasetSlug", "systemPrompt", "narrativeType"] as const) {
      expect(new Set(scopes.map((s) => s[field])).size).toBe(scopes.length);
    }
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
    const prompt = scope.narrativePrompt({ geoCode: "07", geoLevel: "region", geoName: "Central Visayas" });
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
