import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import { getBhwCounts, getDemographics, hsGradOrAbovePct } from "./indicators";
import { getBhwOverview } from "./stepzero";
import { getChildGeos } from "./geo";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";

export type InsightCard = {
  category: string;
  headline: string;
  caption: string;
  href?: string;
};

type InsightGenerator = (geoLevel: GeoLevel, geoCode: string, geoName: string) => Promise<InsightCard | null>;

const LEVEL_NOUN: Record<GeoLevel, string> = {
  national: "national",
  region: "region",
  province: "province",
  citymun: "city/municipality",
  barangay: "barangay",
};

async function accreditationInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const children = await getChildGeos(geoCode, geoLevel);
  if (children.length === 0) return null;
  const childLevel = children[0].geoLevel;

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, geo_name, pct_accredited, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", childLevel)
    .in("geo_code", children.map((c) => c.geoCode))
    .not("pct_accredited", "is", null)
    .order("pct_accredited", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const scopeSuffix = geoLevel === "national" ? "" : ` in ${geoName}`;
  return {
    category: "Accreditation",
    headline: `${data.geo_name} leads all ${LEVEL_NOUN[childLevel]}s${scopeSuffix} on BHW accreditation, at ${data.pct_accredited}%.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
    href: `/place/${childLevel}/${data.geo_code}`,
  };
}

async function trainingInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_training")
    .select("topic_label, coverage_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_code", geoCode)
    .eq("geo_level", geoLevel)
    .not("coverage_pct", "is", null)
    .order("coverage_pct", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const scope = geoLevel === "national" ? "the nation's" : `${geoName}'s`;
  return {
    category: "Training",
    headline: `"${data.topic_label}" is ${scope} biggest training gap, at just ${data.coverage_pct}% coverage.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${geoName} · 2025 snapshot`,
  };
}

async function honorariumInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const children = await getChildGeos(geoCode, geoLevel);
  if (children.length === 0) return null;
  const childLevel = children[0].geoLevel;

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, geo_name, any_honorarium_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", childLevel)
    .in("geo_code", children.map((c) => c.geoCode))
    .not("any_honorarium_pct", "is", null)
    .order("any_honorarium_pct", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const scope = geoLevel === "national" ? "any region" : `any ${LEVEL_NOUN[childLevel]} in ${geoName}`;
  return {
    category: "Honorarium",
    headline: `${data.any_honorarium_pct}% of BHWs in ${data.geo_name} receive some form of honorarium — the highest of ${scope}.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
    href: `/place/${childLevel}/${data.geo_code}`,
  };
}

async function geographyInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();

  // At the national level, provinces (rather than regions, which the other
  // "leader" insights already use) give headline variety — preserved as-is.
  if (geoLevel === "national") {
    const { data } = await supabase
      .from("agg_geo_summary")
      .select("geo_code, geo_name, n_total")
      .eq("dataset_id", datasetId)
      .eq("geo_level", "province")
      .not("n_total", "is", null)
      .order("n_total", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      category: "Geography",
      headline: `${data.geo_name} has more registered BHWs than any other province, at ${data.n_total?.toLocaleString()}.`,
      caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
      href: `/place/province/${data.geo_code}`,
    };
  }

  const children = await getChildGeos(geoCode, geoLevel);
  if (children.length === 0) return null;
  const childLevel = children[0].geoLevel;

  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, geo_name, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", childLevel)
    .in("geo_code", children.map((c) => c.geoCode))
    .not("n_total", "is", null)
    .order("n_total", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    category: "Geography",
    headline: `${data.geo_name} has more registered BHWs than any other ${LEVEL_NOUN[childLevel]} in ${geoName}, at ${data.n_total?.toLocaleString()}.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
    href: `/place/${childLevel}/${data.geo_code}`,
  };
}

async function educationInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const rows = await getDemographics(geoCode, geoLevel, ["education"]);
  const pct = hsGradOrAbovePct(rows);
  if (pct === null) return null;
  const scope = geoLevel === "national" ? "nationally" : `in ${geoName}`;
  return {
    category: "Education",
    headline: `${pct}% of validated BHW profiles ${scope} are high school graduates or higher.`,
    caption: `Educational attainment · ${geoName} · 2025 snapshot`,
    href: `/explore?geoLevel=${geoLevel}&geoCode=${geoCode}&breakdowns=education`,
  };
}

async function workforceInsight(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard | null> {
  const [overview, counts] = await Promise.all([
    getBhwOverview(geoCode, geoLevel),
    getBhwCounts(geoCode, geoLevel),
  ]);
  if (counts?.pctAccredited == null && overview.bhwPer1000Residents === null) return null;
  const parts: string[] = [];
  if (counts?.pctAccredited != null) parts.push(`${counts.pctAccredited}% of validated profiles are accredited`);
  if (overview.bhwPer1000Residents !== null) parts.push(`there are ${overview.bhwPer1000Residents} BHWs per 1,000 residents`);
  const scope = geoLevel === "national" ? "Nationally" : `In ${geoName}`;
  return {
    category: "Workforce",
    headline: `${scope}, ${parts.join(" and ")}.`,
    caption: `N = ${overview.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · ${geoName} · 2025 snapshot`,
  };
}

const INSIGHT_GENERATORS: InsightGenerator[] = [
  accreditationInsight,
  trainingInsight,
  honorariumInsight,
  geographyInsight,
  educationInsight,
  workforceInsight,
];

/**
 * Per-category insight grid, scoped to whichever geo the caller passes — one
 * card per area (as many as have data). At "national" this reproduces the
 * original home-page behavior (regions/provinces are compared against each
 * other, nationally); at any other level, the "leader" generators compare
 * against the current geo's own children (e.g. provinces within a region)
 * and the per-geo generators (training/education/workforce) read that geo's
 * own indicators, so the cards reflect the level the user has filtered into.
 */
export async function getInsights(geoLevel: GeoLevel, geoCode: string, geoName: string): Promise<InsightCard[]> {
  const results = await Promise.all(INSIGHT_GENERATORS.map((generator) => generator(geoLevel, geoCode, geoName)));
  return results.filter((r): r is InsightCard => r !== null);
}

/** Home page convenience wrapper — always national. */
export async function getHomeInsights(): Promise<InsightCard[]> {
  return getInsights("national", NATIONAL_GEO_CODE, "Philippines");
}
