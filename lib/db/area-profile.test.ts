import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getGeoByCode: vi.fn(),
  getGeoAncestors: vi.fn(),
  getBhwOverview: vi.fn(),
  getBhwCounts: vi.fn(),
  getDemographics: vi.fn(),
  getTrainingCoverage: vi.fn(),
  getHonorarium: vi.fn(),
  getHonorariumSufficiency: vi.fn(),
  getProfilingStatus: vi.fn(),
  getUucPhcCounts: vi.fn(),
  getUucPhcCriteria: vi.fn(),
  getUucBhwCoverage: vi.fn(),
  getChildPoverty: vi.fn(),
  getCensusPopulation2024: vi.fn(),
  getPeerRanks: vi.fn(),
  executeSearchDocuments: vi.fn(),
}));

vi.mock("@/lib/db/geo", () => ({
  getGeoByCode: m.getGeoByCode,
  getGeoAncestors: m.getGeoAncestors,
}));
vi.mock("./geo", () => ({ getGeoByCode: m.getGeoByCode, getGeoAncestors: m.getGeoAncestors }));
vi.mock("./stepzero", () => ({ getBhwOverview: m.getBhwOverview }));
vi.mock("./indicators", () => ({
  getBhwCounts: m.getBhwCounts,
  getDemographics: m.getDemographics,
  getTrainingCoverage: m.getTrainingCoverage,
  getHonorarium: m.getHonorarium,
}));
vi.mock("./derived-figures", () => ({ getHonorariumSufficiency: m.getHonorariumSufficiency }));
vi.mock("./profiling-status", () => ({ getProfilingStatus: m.getProfilingStatus }));
vi.mock("./uuc-phc", () => ({ getUucPhcCounts: m.getUucPhcCounts }));
vi.mock("./uuc-phc-criteria", () => ({ getUucPhcCriteria: m.getUucPhcCriteria }));
vi.mock("./uuc-phc-bhw-coverage", () => ({ getUucBhwCoverage: m.getUucBhwCoverage }));
vi.mock("./poverty", () => ({ getChildPoverty: m.getChildPoverty }));
vi.mock("./population", () => ({ getCensusPopulation2024: m.getCensusPopulation2024 }));
vi.mock("./peer-ranks", () => ({ getPeerRanks: m.getPeerRanks }));
vi.mock("@/lib/ai/search-documents", () => ({ executeSearchDocuments: m.executeSearchDocuments }));

const { getAreaProfile, coverageOf } = await import("./area-profile");

const geoAt = (geoLevel: string, geoName = "Basilan") => ({
  geoCode: "150701000",
  geoLevel,
  geoName,
  incomeClass: 3,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.getGeoByCode.mockResolvedValue(geoAt("province"));
  m.getGeoAncestors.mockResolvedValue({ region: null, province: null, citymun: null });
  m.getBhwOverview.mockResolvedValue({ totalBhw: 900 });
  m.getBhwCounts.mockResolvedValue({ nTotal: 43 });
  m.getDemographics.mockResolvedValue([]);
  m.getTrainingCoverage.mockResolvedValue([{ topicSlug: "mch" }]);
  m.getHonorarium.mockResolvedValue([{ payerLevel: "barangay" }]);
  m.getHonorariumSufficiency.mockResolvedValue({ medianCumulativeMonthly: 1500 });
  m.getProfilingStatus.mockResolvedValue({ nValidated: 40 });
  m.getUucPhcCounts.mockResolvedValue({ nListed: 12 });
  m.getUucPhcCriteria.mockResolvedValue({ nRouteIp: 3 });
  m.getUucBhwCoverage.mockResolvedValue({ listed: {} });
  m.getChildPoverty.mockResolvedValue(new Map());
  m.getCensusPopulation2024.mockResolvedValue(400_000);
  m.getPeerRanks.mockResolvedValue(new Map([["pct_accredited", { indicator: "pct_accredited" }]]));
  m.executeSearchDocuments.mockResolvedValue({ results: [] });
});

describe("getAreaProfile", () => {
  it("returns null for a geo_code that is not in dim_geo", async () => {
    m.getGeoByCode.mockResolvedValue(null);
    expect(await getAreaProfile("000000000", "province")).toBeNull();
  });

  it("resolves the national sentinel without a lookup", async () => {
    const profile = await getAreaProfile("PH", "national");
    expect(profile?.geo).toEqual({ geoCode: "PH", geoLevel: "national", geoName: "Philippines" });
    expect(m.getGeoByCode).not.toHaveBeenCalled();
  });

  /**
   * Every aggregate is keyed on (geo_code, geo_level), so a mismatched level makes every section
   * read "no data" — a wrong answer wearing the shape of a finding. Rejecting is the same check
   * `app/uuc-phc/[geoLevel]/[geoCode]` already makes.
   */
  it("rejects a level that disagrees with dim_geo rather than answering a different question", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("citymun"));
    expect(await getAreaProfile("150701000", "region")).toBeNull();
    expect(m.getBhwCounts).not.toHaveBeenCalled();
  });

  it("queries every section at the level dim_geo records", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("citymun"));
    const profile = await getAreaProfile("150701000", "citymun");
    expect(profile?.geo.geoLevel).toBe("citymun");
    expect(m.getBhwCounts).toHaveBeenCalledWith("150701000", "citymun");
  });
});

/**
 * The increment's main correctness requirement: "not built at this level" and "no data" are
 * different findings and must not be reported the same way.
 */
describe("the coverage map", () => {
  it("marks training and honorarium sufficiency as not built at barangay", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("barangay"));
    m.getTrainingCoverage.mockResolvedValue([]);
    m.getHonorariumSufficiency.mockResolvedValue(null);

    const profile = (await getAreaProfile("150701001", "barangay"))!;
    expect(profile.sections.training.state).toBe("not-built-at-this-level");
    expect(profile.sections.training.reason).toMatch(/build decision, not missing data/);
    expect(profile.sections.honorariumSufficiency.state).toBe("not-built-at-this-level");
  });

  it("marks an empty training result at a covered level as no-data, not as unbuilt", async () => {
    m.getTrainingCoverage.mockResolvedValue([]);
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.sections.training.state).toBe("no-data");
  });

  it("marks poverty as not built above city/municipality grain", async () => {
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.sections.poverty.state).toBe("not-built-at-this-level");
    expect(profile.sections.poverty.reason).toMatch(/city\/municipality grain only/);
  });

  it("returns poverty at citymun when the SAE has a row", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("citymun"));
    m.getChildPoverty.mockResolvedValue(new Map([["150701000", { incidence: 21.4 }]]));
    const profile = (await getAreaProfile("150701000", "citymun"))!;
    expect(profile.sections.poverty).toMatchObject({ state: "present", data: { incidence: 21.4 } });
  });

  it("distinguishes an excluded citymun from an unbuilt level", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("citymun"));
    const profile = (await getAreaProfile("150701000", "citymun"))!;
    expect(profile.sections.poverty.state).toBe("no-data");
    expect(profile.sections.poverty.reason).toMatch(/highly urbanised cities are excluded/);
  });

  it.each([
    ["national", /no same-level siblings/],
    ["barangay", /no barangay rows/],
  ] as const)("explains why peer ranks are absent at %s", async (geoLevel, pattern) => {
    m.getGeoByCode.mockResolvedValue(geoAt(geoLevel));
    const profile = (await getAreaProfile(geoLevel === "national" ? "PH" : "150701000", geoLevel))!;
    expect(profile.sections.peerRanks.state).toBe("not-built-at-this-level");
    expect(String(profile.sections.peerRanks.reason)).toMatch(pattern);
    expect(m.getPeerRanks).not.toHaveBeenCalled();
  });

  it("summarises what is present, suppressed and absent", async () => {
    const coverage = coverageOf((await getAreaProfile("150701000", "province"))!);
    expect(coverage.present).toContain("bhwOverview");
    expect(coverage.absent.map((a) => a.source)).toContain("poverty");
    expect(coverage.absent.every((a) => a.reason.length > 0)).toBe(true);
  });
});

describe("resilience", () => {
  // One unavailable table must cost one section, never the profile.
  it("degrades a throwing source to a section rather than failing the profile", async () => {
    m.getUucPhcCounts.mockRejectedValue(new Error("relation does not exist"));
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.sections.uucPhcCounts.state).toBe("no-data");
    expect(profile.sections.bhwOverview.state).toBe("present");
  });

  it("reports a document-search failure without failing the profile", async () => {
    m.executeSearchDocuments.mockResolvedValue({ error: "timed out" });
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.sections.documents.state).toBe("no-data");
  });

  it("warns that a document hit may only mention the place incidentally", async () => {
    m.executeSearchDocuments.mockResolvedValue({ results: [{ chunkId: 1, citation: "slide 37" }] });
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.warnings.join(" ")).toMatch(/incidentally/);
  });
});

describe("cross-dataset suppression", () => {
  /**
   * The consolidated payload publishes both the suppressed breakdown and the group total, which
   * is exactly the differencing path `area-profile-suppression.ts` exists to close. Asserted here
   * too, because the guarantee only holds if the profile actually runs the pass.
   */
  it("closes the differencing path inside the assembled payload", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("barangay"));
    m.getDemographics.mockResolvedValue([
      { dimension: "sex", category: "Male", n: 40, pct: 93.0, isSuppressed: false },
      { dimension: "sex", category: "Female", n: null, pct: null, isSuppressed: true },
    ]);

    const profile = (await getAreaProfile("150701001", "barangay"))!;
    const rows = profile.sections.demographics.data!.rows;

    expect(rows.filter((r) => r.n === null)).toHaveLength(2);
    expect(rows.find((r) => r.category === "Male")).toMatchObject({
      n: null,
      pct: null,
      suppressedBy: "complement",
    });
    expect(profile.sections.demographics.state).toBe("suppressed");
  });

  it("surfaces the withholding in the profile's warnings", async () => {
    m.getGeoByCode.mockResolvedValue(geoAt("barangay"));
    m.getDemographics.mockResolvedValue([
      { dimension: "sex", category: "Male", n: 40, pct: 93.0, isSuppressed: false },
      { dimension: "sex", category: "Female", n: null, pct: null, isSuppressed: true },
    ]);
    const profile = (await getAreaProfile("150701001", "barangay"))!;
    expect(profile.warnings.join(" ")).toMatch(/cannot be recovered by subtracting/);
  });

  it("leaves an unsuppressed breakdown present and untouched", async () => {
    m.getDemographics.mockResolvedValue([
      { dimension: "sex", category: "Male", n: 40, pct: 57.1, isSuppressed: false },
      { dimension: "sex", category: "Female", n: 30, pct: 42.9, isSuppressed: false },
    ]);
    const profile = (await getAreaProfile("150701000", "province"))!;
    expect(profile.sections.demographics.state).toBe("present");
    expect(profile.sections.demographics.data!.rows.every((r) => r.n !== null)).toBe(true);
  });
});
