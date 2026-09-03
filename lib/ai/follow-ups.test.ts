import { describe, expect, it } from "vitest";
import { suggestFollowUps, MAX_FOLLOW_UPS } from "./follow-ups";
import type { AssistantRoute } from "./route";
import type { GeoLevel } from "@/lib/filters/schema";

const route = (over: Partial<AssistantRoute> = {}): AssistantRoute => ({
  lane: "general",
  scope: null,
  output: "answer",
  confidence: "matched",
  ...over,
});

const scoped = (geoName: string, geoLevel: GeoLevel) =>
  route({ lane: "geographic", scope: { geoCode: "X", geoLevel, geoName } });

const QUERY_PAYLOAD = {
  table: "agg_poverty",
  grain: "one geography x SAE year",
  units: {},
  mode: "rows",
  rows: [{ geo_code: "07", poverty_incidence: 21.4 }],
  warnings: [],
};

const DOC_PAYLOAD = {
  query: "GIDA",
  count: 1,
  results: [{ chunkId: 12, citation: "cue cards, slide 37", page: 37, text: "…" }],
};

const INDICATOR_PAYLOAD = {
  geoCode: "150701000",
  geoLevel: "province",
  geoName: "Basilan",
  totalBhw: 900,
};

describe("suggestFollowUps", () => {
  it("offers a peer comparison for a scoped geography", () => {
    expect(suggestFollowUps(scoped("Basilan", "province"), [])).toContain(
      "How does Basilan compare with its peers?",
    );
  });

  it("takes the geography from a payload when the route has no scope", () => {
    expect(suggestFollowUps(route(), [INDICATOR_PAYLOAD])).toContain(
      "How does Basilan compare with its peers?",
    );
  });

  /**
   * `agg_peer_ranks` has no row at national and stops above barangay. Offering a question
   * guaranteed to return "not ranked at this level" trains the reader to ignore the suggestions.
   */
  it("does not offer a peer comparison at barangay level", () => {
    const suggestions = suggestFollowUps(scoped("Poblacion", "barangay"), []);
    expect(suggestions.every((s) => !s.includes("compare with its peers"))).toBe(true);
  });

  it("does not offer a drill-down at barangay level, which has no children", () => {
    const suggestions = suggestFollowUps(scoped("Poblacion", "barangay"), []);
    expect(suggestions.every((s) => !s.includes("inside"))).toBe(true);
  });

  it("offers a supersession check only when a document passage came back", () => {
    expect(suggestFollowUps(route(), [DOC_PAYLOAD])).toContain(
      "Was any issuance behind this superseded?",
    );
    expect(suggestFollowUps(route(), [QUERY_PAYLOAD])).not.toContain(
      "Was any issuance behind this superseded?",
    );
  });

  it("offers a lineage question naming the table that was actually read", () => {
    expect(suggestFollowUps(route(), [QUERY_PAYLOAD])).toContain(
      "Where does agg_poverty come from?",
    );
  });

  // The property that keeps a suggestion a promise the assistant can keep.
  it("never names a table or place that is not in this turn's payloads", () => {
    const suggestions = suggestFollowUps(route(), [QUERY_PAYLOAD]);
    expect(suggestions.join(" ")).not.toMatch(/Basilan|agg_bhw_counts/);
  });

  it("ignores a payload that is a refusal rather than a result", () => {
    const suggestions = suggestFollowUps(route(), [
      { error: "Table agg_secret is not registered." },
    ]);
    expect(suggestions.every((s) => !s.includes("agg_secret"))).toBe(true);
  });

  it("caps the list and never repeats a suggestion", () => {
    const suggestions = suggestFollowUps(scoped("Basilan", "province"), [
      QUERY_PAYLOAD,
      QUERY_PAYLOAD,
      DOC_PAYLOAD,
      INDICATOR_PAYLOAD,
    ]);
    expect(suggestions.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it("falls back to a discovery prompt only when nothing else is groundable", () => {
    expect(suggestFollowUps(route(), [])).toEqual(["Which datasets can you reach for this?"]);
    // ...and never crowds out a grounded suggestion.
    expect(suggestFollowUps(route(), [QUERY_PAYLOAD])).not.toContain(
      "Which datasets can you reach for this?",
    );
  });

  it("returns nothing rather than a generic prompt on a lane that had no results", () => {
    expect(suggestFollowUps(route({ lane: "policy" }), [])).toEqual([]);
  });
});
