import { describe, expect, it } from "vitest";
import { createInternalTools } from "./dataset-tools";
import { INTERNAL_SYSTEM_PROMPT } from "./internal-system-prompt";
import { TOOLS } from "./tools";

/**
 * The registration half of "a tool the model never selects has not shipped"
 * (docs/AI_ASSISTANT_PLAN.md §8). `app/api/ai/assistant/route.test.ts` mocks `createInternalTools`
 * to isolate the route, so without this file nothing checks that the real tool set contains what
 * each increment claims to have added — a tool could be written, tested in isolation, and never
 * reach the model.
 *
 * It also guards §9.1 from the other side: the public tool set must never grow a tool that reads
 * a service-role-only table. `searchDocuments` reads internal budget material (§12.5), so its
 * absence from `TOOLS` is a security property, not a packaging detail.
 */

const names = (tools: { definition: { name: string } }[]) => tools.map((t) => t.definition.name);

describe("the internal tool set", () => {
  const internal = names(createInternalTools());

  it("spans all three retrieval paths from §2", () => {
    expect(internal).toEqual(
      expect.arrayContaining(["queryDataset", "traverseGraph", "searchDocuments"]),
    );
  });

  it("keeps the hand-written indicator tools alongside the generic ones", () => {
    expect(internal).toEqual(expect.arrayContaining(names(TOOLS)));
  });

  it("registers each tool exactly once", () => {
    expect(new Set(internal).size).toBe(internal.length);
  });
});

describe("the public tool set", () => {
  const publicNames = names(TOOLS);

  it.each(["searchDocuments", "traverseGraph", "queryDataset", "listDatasets"])(
    "never exposes %s — these read service-role-only tables (§9.1)",
    (name) => {
      expect(publicNames).not.toContain(name);
    },
  );
});

describe("the internal system prompt", () => {
  // Not every tool: the seven hand-written indicator tools carried over from the public set are
  // self-describing ("getHonorariumStats" needs no rule to be picked correctly). The three the
  // plan added do need steering — a model that has never been told when a question is a subtree
  // walk, a registry query or a document lookup will answer it from the wrong path or not at all,
  // which is what "a tool the model never selects has not shipped" means in practice.
  it.each(["listDatasets", "queryDataset", "traverseGraph", "searchDocuments"])(
    "tells the model when to reach for %s",
    (name) => {
      expect(INTERNAL_SYSTEM_PROMPT).toContain(name);
    },
  );

  it("carries §12.4's rule for a figure that comes from a document, not the data", () => {
    expect(INTERNAL_SYSTEM_PROMPT).toContain("attributed and dated");
    expect(INTERNAL_SYSTEM_PROMPT).toContain("give BOTH with their as-of dates");
  });

  it("keeps grounding unrelaxed: numbers still come only from this turn's tool calls", () => {
    expect(INTERNAL_SYSTEM_PROMPT).toContain("ONLY source of any number you state is a tool call");
  });
});
