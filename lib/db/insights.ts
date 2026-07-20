import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import { getBhwCounts, getDemographics, hsGradOrAbovePct } from "./indicators";
import { getBhwOverview } from "./stepzero";

export type InsightCard = {
  category: string;
  headline: string;
  caption: string;
  href?: string;
};

type InsightGenerator = () => Promise<InsightCard | null>;

async function accreditationInsight(): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, geo_name, pct_accredited, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", "region")
    .not("pct_accredited", "is", null)
    .order("pct_accredited", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    category: "Accreditation",
    headline: `${data.geo_name} leads all regions on BHW accreditation, at ${data.pct_accredited}%.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
    href: `/place/region/${data.geo_code}`,
  };
}

async function trainingInsight(): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_training")
    .select("topic_label, coverage_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_code", "PH")
    .eq("geo_level", "national")
    .not("coverage_pct", "is", null)
    .order("coverage_pct", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    category: "Training",
    headline: `"${data.topic_label}" is the nation's biggest training gap, at just ${data.coverage_pct}% coverage.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · Philippines · 2025 snapshot`,
  };
}

async function honorariumInsight(): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_code, geo_name, any_honorarium_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", "region")
    .not("any_honorarium_pct", "is", null)
    .order("any_honorarium_pct", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    category: "Honorarium",
    headline: `${data.any_honorarium_pct}% of BHWs in ${data.geo_name} receive some form of honorarium — the highest of any region.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
    href: `/place/region/${data.geo_code}`,
  };
}

async function geographyInsight(): Promise<InsightCard | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
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

async function educationInsight(): Promise<InsightCard | null> {
  const rows = await getDemographics("PH", "national", ["education"]);
  const pct = hsGradOrAbovePct(rows);
  if (pct === null) return null;
  return {
    category: "Education",
    headline: `${pct}% of validated BHW profiles nationally are high school graduates or higher.`,
    caption: "Educational attainment · Philippines · 2025 snapshot",
    href: "/explore?geoLevel=national&geoCode=PH&breakdowns=education",
  };
}

async function workforceInsight(): Promise<InsightCard | null> {
  const [overview, counts] = await Promise.all([
    getBhwOverview("PH", "national"),
    getBhwCounts("PH", "national"),
  ]);
  if (counts?.pctAccredited == null && overview.bhwPer1000Residents === null) return null;
  const parts: string[] = [];
  if (counts?.pctAccredited != null) parts.push(`${counts.pctAccredited}% of validated profiles are accredited`);
  if (overview.bhwPer1000Residents !== null) parts.push(`there are ${overview.bhwPer1000Residents} BHWs per 1,000 residents`);
  return {
    category: "Workforce",
    headline: `Nationally, ${parts.join(" and ")}.`,
    caption: `N = ${overview.validatedProfiles?.toLocaleString() ?? "—"} validated profiles · Philippines · 2025 snapshot`,
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
 * Per-category insight grid for the home page — one card per area (as many as
 * have data), replacing the single rotating spotlight. Reuses the same
 * aggregate tables and query shapes as lib/db/spotlight.ts (which stays in
 * place for the AI-insight rotation) but runs every category at once instead
 * of picking one per day, and drops categories with no data instead of
 * falling through to a substitute.
 */
export async function getHomeInsights(): Promise<InsightCard[]> {
  const results = await Promise.all(INSIGHT_GENERATORS.map((generator) => generator()));
  return results.filter((r): r is InsightCard => r !== null);
}
