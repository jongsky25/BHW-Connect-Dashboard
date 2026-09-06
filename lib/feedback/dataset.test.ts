import { describe, expect, it } from "vitest";
import { datasetSlugForPath } from "./dataset";

describe("datasetSlugForPath", () => {
  it("routes the UUC for PHC section, at every depth", () => {
    expect(datasetSlugForPath("/uuc-phc")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/uuc-phc/region/14")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/uuc-phc/citymun/1402706")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/uuc-phc/methodology")).toBe("uuc-phc-2025");
  });

  it("routes the other single-dataset sections", () => {
    expect(datasetSlugForPath("/profiling-status")).toBe("bhw-profiling-status-2026");
    expect(datasetSlugForPath("/profiling-status/region/07")).toBe("bhw-profiling-status-2026");
    expect(datasetSlugForPath("/bhw")).toBe("bhw-2025");
    expect(datasetSlugForPath("/place/citymun/0102804")).toBe("bhw-2025");
    expect(datasetSlugForPath("/facilities")).toBe("nhfr-2026-09");
    expect(datasetSlugForPath("/facilities/region/14")).toBe("nhfr-2026-09");
  });

  it("returns null on multi-dataset surfaces rather than picking one", () => {
    // /explore and /compare render BHW figures beside census population and SAE poverty. A slug
    // here would be filterable *and* wrong, which is worse than none: these stay triaged by path.
    expect(datasetSlugForPath("/explore")).toBeNull();
    expect(datasetSlugForPath("/compare")).toBeNull();
  });

  it("returns null on pages that are not a dataset surface at all", () => {
    for (const path of ["/", "/feedback", "/glossary", "/methodology", "/privacy", "/roadmap"]) {
      expect(datasetSlugForPath(path), path).toBeNull();
    }
  });

  it("does not match a prefix that is only a string prefix", () => {
    // The failure this guards: `/bhw-something` is not the BHW Census section.
    expect(datasetSlugForPath("/bhwx")).toBeNull();
    expect(datasetSlugForPath("/uuc-phc-archive")).toBeNull();
    expect(datasetSlugForPath("/placeholder")).toBeNull();
  });

  it("ignores a trailing slash, a query string and a fragment", () => {
    expect(datasetSlugForPath("/uuc-phc/")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/uuc-phc?from=portal")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/uuc-phc/region/14#regions")).toBe("uuc-phc-2025");
    expect(datasetSlugForPath("/explore?geoLevel=region")).toBeNull();
  });

  it("treats a missing path as unknown, never as a match", () => {
    expect(datasetSlugForPath(null)).toBeNull();
    expect(datasetSlugForPath(undefined)).toBeNull();
    expect(datasetSlugForPath("")).toBeNull();
  });
});
