import type { MetadataRoute } from "next";
import { getAllGeosAtLevels } from "@/lib/db/geo";
import { getProfilingStatusStaticParams } from "@/lib/db/profiling-status";
import { getUucPhcStaticParams } from "@/lib/db/uuc-phc";
import { getDistrictIndex } from "@/lib/db/districts";

const BASE_URL = "https://bhw-connect-jongsky25s-projects.vercel.app";

const STATIC_PATHS = [
  "",
  "/bhw",
  "/explore",
  "/compare",
  "/methodology",
  "/glossary",
  "/data-quality",
  "/privacy",
  "/feedback",
  "/roadmap",
  "/profiling-status",
  "/profiling-status/methodology",
  "/districts",
  "/districts/corrections",
  "/uuc-phc",
  // The section's own pages. The per-area routes under /criteria and /indicators are the same
  // drill-down as /uuc-phc/<level>/<code> below and are deliberately not enumerated a second and
  // third time: one canonical set of place URLs per section is what a sitemap is for.
  "/uuc-phc/criteria",
  "/uuc-phc/indicators",
  "/uuc-phc/data-quality",
  "/uuc-phc/methodology",
];

/**
 * Region/province/citymun place pages only — barangay-level (~39K URLs) is
 * skipped for v1 per BUILD_PLAN.md §5, to keep the sitemap a reasonable size
 * and focused on the pages worth a search engine's attention.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Region + province + citymun is ~1,775 rows — past the platform's hard
  // 1,000-row-per-request cap (BUILD_PLAN.md pitfall P9), so this paginates
  // internally rather than a single query, which would silently truncate.
  const [geos, profilingGeos, uucPhcGeos, districts] = await Promise.all([
    getAllGeosAtLevels(["region", "province", "citymun"]),
    // Only region/province profiling pages that actually have data (city/mun is ISR).
    getProfilingStatusStaticParams(),
    // Region + province UUC for PHC pages (city/mun is ISR, as above).
    getUucPhcStaticParams(),
    // 250 legislative districts (D2.1/D2.2) — well under the 1,000-row page cap, one request.
    getDistrictIndex(),
  ]);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${BASE_URL}${path}`,
    changeFrequency: "monthly",
    priority:
      path === "" || path === "/bhw" || path === "/profiling-status" || path === "/uuc-phc"
        ? 1
        : 0.6,
  }));

  const placeEntries: MetadataRoute.Sitemap = geos.map((geo) => ({
    url: `${BASE_URL}/place/${geo.geoLevel}/${geo.geoCode}`,
    changeFrequency: "monthly",
    priority: geo.geoLevel === "region" ? 0.8 : geo.geoLevel === "province" ? 0.6 : 0.4,
  }));

  const profilingEntries: MetadataRoute.Sitemap = profilingGeos.map((geo) => ({
    url: `${BASE_URL}/profiling-status/${geo.geoLevel}/${geo.geoCode}`,
    changeFrequency: "weekly",
    priority: geo.geoLevel === "region" ? 0.8 : 0.6,
  }));

  // Annual publication, so a monthly change frequency rather than the profiling section's weekly.
  const uucPhcEntries: MetadataRoute.Sitemap = uucPhcGeos.map((geo) => ({
    url: `${BASE_URL}/uuc-phc/${geo.geoLevel}/${geo.geoCode}`,
    changeFrequency: "monthly",
    priority: geo.geoLevel === "region" ? 0.8 : 0.6,
  }));

  const districtEntries: MetadataRoute.Sitemap = districts.map((d) => ({
    url: `${BASE_URL}/districts/${d.districtCode}`,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [
    ...staticEntries,
    ...placeEntries,
    ...profilingEntries,
    ...uucPhcEntries,
    ...districtEntries,
  ];
}
