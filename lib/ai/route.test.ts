import { describe, expect, it } from "vitest";
import {
  applyCarriedScope,
  applyPinned,
  detectLane,
  detectOutput,
  normalise,
  pickScope,
  routeByRules,
  routeSystemFacts,
  type AssistantRoute,
} from "./route";

const geo = (
  geoName: string,
  geoCode: string,
  geoLevel: "region" | "province" | "citymun" | "barangay",
) => ({
  geoName,
  geoCode,
  geoLevel,
});

const BASILAN = geo("Basilan", "150701000", "province");

describe("normalise", () => {
  it("folds case, punctuation and diacritics", () => {
    expect(normalise("Basilán,")).toBe("basilan");
    expect(normalise("Zamboanga  del   Sur!")).toBe("zamboanga del sur");
  });
});

describe("detectLane", () => {
  it.each([
    ["is DC No. 2025-0549 still in force?", "policy"],
    ["which circular governs the GIDA list", "policy"],
    ["what built agg_honorarium", "lineage"],
    ["where does pct_accredited come from", "lineage"],
    ["which fields are missing at barangay level", "data-quality"],
    ["do the cue cards and SQL disagree on the total", "data-quality"],
  ] as const)("routes %s to %s", (question, lane) => {
    expect(detectLane(question)).toBe(lane);
  });

  it("returns null when no lane vocabulary is present", () => {
    expect(detectLane("how many are there")).toBeNull();
  });

  // Priority, not preference: a supersession question that happens to name a place must not be
  // answered from dim_geo.
  it("prefers policy over a place name", () => {
    expect(routeByRules("is the GIDA circular still in force in Basilan?", [BASILAN])?.lane).toBe(
      "policy",
    );
  });

  it("still resolves the scope of a policy question", () => {
    expect(
      routeByRules("is the GIDA circular still in force in Basilan?", [BASILAN])?.scope,
    ).toMatchObject({ geoCode: "150701000" });
  });
});

describe("detectOutput", () => {
  it.each([
    ["chart accreditation by region", "chart"],
    ["make me a slide on honorarium", "slide"],
    ["build a deck for the briefing", "slide"],
    ["give me a profile of Basilan", "profile"],
    ["everything about Basilan", "profile"],
  ] as const)("reads %s as %s", (question, output) => {
    expect(detectOutput(question)).toBe(output);
  });

  // Absence is not ambiguity: a question that does not ask for a chart wants prose, and treating
  // that as unresolved would spend a provider call on every plain question.
  it("defaults to answer rather than reporting the output unresolved", () => {
    expect(detectOutput("how many BHWs are accredited in Basilan")).toBe("answer");
  });
});

describe("pickScope", () => {
  it("accepts a hit whose name appears in the question", () => {
    expect(pickScope("accreditation in Basilan", [BASILAN])).toMatchObject({ geoName: "Basilan" });
  });

  it("skips a hit the question never names, even as searchGeo's top result", () => {
    expect(pickScope("how many BHWs are accredited", [BASILAN])).toBeNull();
  });

  /**
   * The regression this guard exists for. `searchGeo` is fuzzy by design, so a question with no
   * place in it can still return a barangay whose name is a domain word — and scoping a national
   * question to one barangay is invisible in the answer while its figures still audit clean.
   */
  it("rejects a place whose only distinctive token is domain vocabulary", () => {
    const trainingBarangay = geo("Training", "999999999", "barangay");
    expect(pickScope("what is the training coverage nationally", [trainingBarangay])).toBeNull();
  });

  it("matches a multi-word name on its distinctive tokens only", () => {
    const zds = geo("Zamboanga del Sur", "097300000", "province");
    expect(pickScope("honorarium in Zamboanga Sur", [zds])).toMatchObject({ geoCode: "097300000" });
  });

  it("falls through to a later hit when the first is not named", () => {
    const noise = geo("Poblacion", "111111111", "barangay");
    expect(pickScope("accreditation in Basilan", [noise, BASILAN])).toMatchObject({
      geoName: "Basilan",
    });
  });
});

describe("routeByRules", () => {
  it("routes a place question geographically", () => {
    expect(routeByRules("accreditation in Basilan", [BASILAN])).toEqual({
      lane: "geographic",
      scope: { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" },
      output: "answer",
      confidence: "matched",
    });
  });

  // The cheap win: a plain data question resolves with no provider call at all.
  it("routes a domain question to general without needing a place", () => {
    expect(routeByRules("how many BHWs are accredited", [])?.lane).toBe("general");
  });

  it("returns null only when there is no signal at all", () => {
    expect(routeByRules("what about that thing we discussed", [])).toBeNull();
  });
});

describe("applyPinned", () => {
  const base: AssistantRoute = {
    lane: "general",
    scope: null,
    output: "answer",
    confidence: "matched",
  };

  it("lets a pinned lane win over the computed one", () => {
    expect(applyPinned(base, { lane: "policy" }).lane).toBe("policy");
  });

  it("leaves unpinned fields alone", () => {
    expect(applyPinned(base, { lane: "policy" }).output).toBe("answer");
  });

  // Scope is not pinnable by construction — see the regression in `applyCarriedScope` below.
  it("never lets a pin touch the scope", () => {
    const scoped: AssistantRoute = {
      ...base,
      scope: { geoCode: "PH", geoLevel: "national", geoName: "Philippines" },
    };
    expect(applyPinned(scoped, { lane: "policy" }).scope).toEqual(scoped.scope);
  });
});

describe("applyCarriedScope", () => {
  const CEBU = { geoCode: "072200000", geoLevel: "province" as const, geoName: "Cebu" };
  const BASILAN_SCOPE = { geoCode: "150701000", geoLevel: "province" as const, geoName: "Basilan" };

  const route = (scope: typeof CEBU | null): AssistantRoute => ({
    lane: "geographic",
    scope,
    output: "answer",
    confidence: "matched",
  });

  // This is what makes "and its training coverage?" resolve.
  it("fills a scope the question did not resolve", () => {
    expect(applyCarriedScope(route(null), BASILAN_SCOPE).scope).toEqual(BASILAN_SCOPE);
  });

  /**
   * The regression this whole fallback/override distinction exists for. Ask about Basilan, then
   * about Cebu: if the carried scope won, the second answer would be about Basilan — confidently,
   * and with figures that pass the numeric audit, because they are real Basilan figures.
   */
  it("never overrides a scope the question resolved for itself", () => {
    expect(applyCarriedScope(route(CEBU), BASILAN_SCOPE).scope).toEqual(CEBU);
  });

  it("is a no-op when nothing was carried", () => {
    expect(applyCarriedScope(route(null), null).scope).toBeNull();
    expect(applyCarriedScope(route(null), undefined).scope).toBeNull();
  });
});

describe("routeSystemFacts", () => {
  const route = (over: Partial<AssistantRoute>): AssistantRoute => ({
    lane: "general",
    scope: null,
    output: "answer",
    confidence: "matched",
    ...over,
  });

  it("is empty for a general answer, so nothing is appended for nothing", () => {
    expect(routeSystemFacts(route({}))).toBe("");
  });

  it("hands the model the resolved geo_code instead of a place name to search for", () => {
    const facts = routeSystemFacts(
      route({ scope: { geoCode: "150701000", geoLevel: "province", geoName: "Basilan" } }),
    );
    expect(facts).toContain("150701000");
    expect(facts).toContain("do not call searchGeo");
  });

  it("makes the policy lane require the supersession walk", () => {
    expect(routeSystemFacts(route({ lane: "policy" }))).toContain("supersedes");
  });

  // dim_geo has containment and no coordinates; the model must be told, not left to approximate.
  it("tells the geographic lane that proximity is unanswerable", () => {
    expect(routeSystemFacts(route({ lane: "geographic" }))).toMatch(/near|adjacent/);
  });
});
