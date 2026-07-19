import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";

export type SpotlightInsight = {
  headline: string;
  caption: string;
};

type InsightGenerator = () => Promise<SpotlightInsight | null>;

async function regionWithHighestAccreditation(): Promise<SpotlightInsight | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_name, pct_accredited, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", "region")
    .not("pct_accredited", "is", null)
    .order("pct_accredited", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    headline: `${data.geo_name} leads all regions on BHW accreditation, at ${data.pct_accredited}%.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
  };
}

async function nationalTrainingGap(): Promise<SpotlightInsight | null> {
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
    headline: `"${data.topic_label}" is the nation's biggest training gap, at just ${data.coverage_pct}% coverage.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · Philippines · 2025 snapshot`,
  };
}

async function regionWithMostHonorarium(): Promise<SpotlightInsight | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_name, any_honorarium_pct, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", "region")
    .not("any_honorarium_pct", "is", null)
    .order("any_honorarium_pct", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    headline: `${data.any_honorarium_pct}% of BHWs in ${data.geo_name} receive some form of honorarium — the highest of any region.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
  };
}

async function largestProvinceByBhwCount(): Promise<SpotlightInsight | null> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return null;
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select("geo_name, n_total")
    .eq("dataset_id", datasetId)
    .eq("geo_level", "province")
    .not("n_total", "is", null)
    .order("n_total", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    headline: `${data.geo_name} has more registered BHWs than any other province, at ${data.n_total?.toLocaleString()}.`,
    caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
  };
}

const INSIGHT_GENERATORS: InsightGenerator[] = [
  regionWithHighestAccreditation,
  nationalTrainingGap,
  regionWithMostHonorarium,
  largestProvinceByBhwCount,
];

/**
 * Template-driven "insight of the day" — Phase 1 has no AI (§2), so this
 * rotates deterministically through a small curated list of real aggregate
 * queries, one per day, falling through to the next template if a given
 * day's query comes back empty (e.g. transient read failure).
 */
export async function getSpotlightInsight(date: Date = new Date()): Promise<SpotlightInsight | null> {
  const dayOfYear = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) /
      86_400_000,
  );

  for (let offset = 0; offset < INSIGHT_GENERATORS.length; offset++) {
    const generator =
      INSIGHT_GENERATORS[(dayOfYear + offset) % INSIGHT_GENERATORS.length];
    const insight = await generator();
    if (insight) return insight;
  }

  return null;
}
