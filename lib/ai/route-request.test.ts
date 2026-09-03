import { beforeEach, describe, expect, it, vi } from "vitest";

/** Mirrors `CascadeResult` in lib/ai/quota.ts — declared here so `mockResolvedValueOnce` can
 * return the capped arm without the mock's inferred type narrowing to the happy one. */
type CascadeResult =
  | { allCapped: false; provider: "gemini"; completion: { content: string | null; toolCalls: [] } }
  | { allCapped: true; provider: null };

// `OK` lives inside the hoisted factory, not beside it: `vi.hoisted` runs its callback above the
// module body, so a module-level const referenced from in here would be in its temporal dead zone.
// The type alias is fine there — types are erased.
const { OK, searchGeo, getGeoByCode, completeWithCascade } = vi.hoisted(() => {
  const OK: CascadeResult = {
    allCapped: false,
    provider: "gemini",
    completion: { content: '{"lane":"general","output":"answer"}', toolCalls: [] },
  };
  return {
    OK,
    searchGeo: vi.fn(async () => [] as unknown[]),
    getGeoByCode: vi.fn(async () => null as unknown),
    // The explicit return type keeps the mock's signature at the union, so a test may resolve the
    // all-capped arm without TypeScript having narrowed it away.
    completeWithCascade: vi.fn(async (): Promise<CascadeResult> => OK),
  };
});
vi.mock("@/lib/db/search", () => ({ searchGeo }));
vi.mock("@/lib/db/geo", () => ({ getGeoByCode }));
vi.mock("./quota", () => ({ completeWithCascade }));

const { routeRequest, parseClassification, verifyScope, clearRouteMemo } =
  await import("./route-request");

const BASILAN = {
  geoCode: "150701000",
  geoLevel: "province" as const,
  geoName: "Basilan",
  nTotal: 1,
  parentChain: {},
};

beforeEach(() => {
  clearRouteMemo();
  searchGeo.mockClear();
  getGeoByCode.mockReset().mockResolvedValue(null);
  completeWithCascade.mockClear();
  completeWithCascade.mockResolvedValue(OK);
});

describe("routeRequest — the free path", () => {
  /**
   * The load-bearing property of this increment. Gemini is seeded at 10 requests/minute
   * (lib/ai/quota.ts) and one question already spends up to six; a router that always called a
   * provider would be a seventh on the same budget.
   */
  it("routes a policy question with zero provider calls", async () => {
    const route = await routeRequest("is DC No. 2025-0549 still in force?");
    expect(route.lane).toBe("policy");
    expect(route.confidence).toBe("matched");
    expect(completeWithCascade).not.toHaveBeenCalled();
  });

  it("resolves a place question with zero provider calls", async () => {
    searchGeo.mockResolvedValueOnce([BASILAN]);
    const route = await routeRequest("accreditation in Basilan");
    expect(route.scope).toMatchObject({ geoCode: "150701000" });
    expect(completeWithCascade).not.toHaveBeenCalled();
  });

  it("routes a plain domain question with zero provider calls", async () => {
    const route = await routeRequest("how many BHWs are accredited");
    expect(route.lane).toBe("general");
    expect(completeWithCascade).not.toHaveBeenCalled();
  });
});

describe("routeRequest — the fallback", () => {
  it("spends exactly one call on a question with no signal", async () => {
    completeWithCascade.mockResolvedValueOnce({
      ...OK,
      completion: { content: '{"lane":"lineage","output":"chart"}', toolCalls: [] },
    });
    const route = await routeRequest("what about that thing we discussed");
    expect(completeWithCascade).toHaveBeenCalledTimes(1);
    expect(route).toMatchObject({ lane: "lineage", output: "chart", confidence: "inferred" });
  });

  it("passes no tools to the classifier call", async () => {
    await routeRequest("what about that thing we discussed");
    expect(completeWithCascade).toHaveBeenCalledWith(expect.any(Array), []);
  });

  // Degrade, never error (§1). Every failure lands on the assistant's pre-5.1 behaviour.
  it("falls back to general/answer when the classifier returns unparseable text", async () => {
    completeWithCascade.mockResolvedValueOnce({
      ...OK,
      completion: { content: "I think this is about honoraria.", toolCalls: [] },
    });
    const route = await routeRequest("what about that thing we discussed");
    expect(route).toMatchObject({ lane: "general", output: "answer", confidence: "inferred" });
  });

  it("falls back when every provider is capped", async () => {
    completeWithCascade.mockResolvedValueOnce({ allCapped: true, provider: null });
    const route = await routeRequest("what about that thing we discussed");
    expect(route.lane).toBe("general");
  });

  // A cached route must not be cached *with* someone's pins, or the next reader inherits them.
  it("memoises the computed route but re-applies pins per request", async () => {
    await routeRequest("what about that thing we discussed");
    const second = await routeRequest("What about that thing we discussed  ", { lane: "policy" });
    expect(completeWithCascade).toHaveBeenCalledTimes(1);
    expect(second.lane).toBe("policy");
    const third = await routeRequest("what about that thing we discussed");
    expect(third.lane).toBe("general");
  });
});

describe("parseClassification", () => {
  it("reads a bare object", () => {
    expect(parseClassification('{"lane":"policy","output":"slide"}')).toEqual({
      lane: "policy",
      output: "slide",
    });
  });

  // Free-tier models fence and preamble their JSON often enough that a whole-string parse fails
  // on correct classifications.
  it("reads an object wrapped in prose or a code fence", () => {
    expect(
      parseClassification('Sure!\n```json\n{"lane":"lineage","output":"answer"}\n```'),
    ).toEqual({ lane: "lineage", output: "answer" });
  });

  it("keeps a valid lane when the output is missing or unknown", () => {
    expect(parseClassification('{"lane":"policy","output":"interpretive-dance"}')).toEqual({
      lane: "policy",
      output: "answer",
    });
  });

  it.each([null, "", "not json", '{"lane":"nonsense","output":"answer"}', '{"output":"chart"}'])(
    "returns null rather than coercing %s",
    (content) => {
      expect(parseClassification(content)).toBeNull();
    },
  );
});

/**
 * A pinned scope is the one piece of route state the browser authors, and it is rendered into the
 * system prompt as an assertion the model is told to trust — so it is re-derived from dim_geo
 * rather than existence-checked.
 */
describe("verifyScope", () => {
  it("re-derives the level and name from the row, discarding what the client claimed", async () => {
    getGeoByCode.mockResolvedValueOnce({
      geoCode: "150701000",
      geoLevel: "province",
      geoName: "Basilan",
      incomeClass: 3,
    });
    await expect(
      verifyScope({ geoCode: "150701000", geoLevel: "barangay", geoName: "Somewhere Else" }),
    ).resolves.toEqual({ geoCode: "150701000", geoLevel: "province", geoName: "Basilan" });
  });

  it("resolves the national sentinel without a lookup", async () => {
    await expect(
      verifyScope({ geoCode: "PH", geoLevel: "national", geoName: "x" }),
    ).resolves.toEqual({ geoCode: "PH", geoLevel: "national", geoName: "Philippines" });
    expect(getGeoByCode).not.toHaveBeenCalled();
  });

  it("returns null for a geo_code that is not in dim_geo", async () => {
    await expect(
      verifyScope({ geoCode: "000000000", geoLevel: "province", geoName: "Forged" }),
    ).resolves.toBeNull();
  });
});

describe("routeRequest — carried scope", () => {
  it("drops a forged carried scope rather than passing it to the prompt", async () => {
    const route = await routeRequest("how many BHWs are accredited", undefined, {
      geoCode: "000000000",
      geoLevel: "province",
      geoName: "Forged",
    });
    expect(route.scope).toBeNull();
  });

  it("re-derives a carried scope that resolves, and uses it for an unscoped question", async () => {
    getGeoByCode.mockResolvedValueOnce({
      geoCode: "150701000",
      geoLevel: "province",
      geoName: "Basilan",
      incomeClass: 3,
    });
    const route = await routeRequest("and its training coverage?", undefined, {
      geoCode: "150701000",
      geoLevel: "barangay",
      geoName: "Whatever The Client Said",
    });
    // Name and level come from the row, not from what the browser claimed.
    expect(route.scope).toEqual({
      geoCode: "150701000",
      geoLevel: "province",
      geoName: "Basilan",
    });
  });

  /** The regression: a new question that names its own place must beat the carried one. */
  it("lets the question's own place win over the carried one", async () => {
    searchGeo.mockResolvedValueOnce([
      { geoCode: "072200000", geoLevel: "province", geoName: "Cebu", nTotal: 1, parentChain: {} },
    ]);
    getGeoByCode.mockResolvedValueOnce({
      geoCode: "150701000",
      geoLevel: "province",
      geoName: "Basilan",
      incomeClass: 3,
    });
    const route = await routeRequest("accreditation in Cebu", undefined, {
      geoCode: "150701000",
      geoLevel: "province",
      geoName: "Basilan",
    });
    expect(route.scope).toMatchObject({ geoName: "Cebu" });
  });
});

describe("routeRequest — never a precondition for an answer", () => {
  // `searchGeo` builds a Supabase client before it swallows anything, and that throws when the
  // environment is unconfigured. A routing failure must cost the scope chip, not the answer.
  it("still routes when the geo lookup throws", async () => {
    searchGeo.mockRejectedValueOnce(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));
    const route = await routeRequest("is DC No. 2025-0549 still in force?");
    expect(route.lane).toBe("policy");
    expect(route.scope).toBeNull();
  });
});
