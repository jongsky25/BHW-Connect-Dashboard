import type { MetadataRoute } from "next";
import { getAllGeosAtLevels } from "@/lib/db/geo";

const BASE_URL = "https://bhw-connect.vercel.app";

const STATIC_PATHS = [
  "",
  "/explore",
  "/compare",
  "/methodology",
  "/glossary",
  "/data-quality",
  "/privacy",
  "/feedback",
  "/roadmap",
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
  const geos = await getAllGeosAtLevels(["region", "province", "citymun"]);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${BASE_URL}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.6,
  }));

  const placeEntries: MetadataRoute.Sitemap = geos.map((geo) => ({
    url: `${BASE_URL}/place/${geo.geoLevel}/${geo.geoCode}`,
    changeFrequency: "monthly",
    priority: geo.geoLevel === "region" ? 0.8 : geo.geoLevel === "province" ? 0.6 : 0.4,
  }));

  return [...staticEntries, ...placeEntries];
}
