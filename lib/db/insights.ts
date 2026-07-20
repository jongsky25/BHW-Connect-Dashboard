import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { getActiveDatasetId } from "./dataset";
import {
  getBhwCounts,
  getCertification,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
  hsGradOrAbovePct,
  type BhwCounts,
} from "./indicators";
import { getStepzeroCounts, householdsPerBhw, type StepzeroCounts } from "./stepzero";
import { getChildGeos, getGeoAncestors, type GeoAncestors, type GeoOption } from "./geo";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";

export type InsightCard = {
  /** Stable per-generator identity — React key, and unique across the grid. */
  id: string;
  category: string;
  headline: string;
  caption: string;
  href?: string;
  /** Editorial noteworthiness used to curate the grid: a static per-generator
   * base rank plus small dynamic boosts for magnitude (bigger gap, larger
   * deviation from parent). Not shown to users. */
  score: number;
};

const LEVEL_NOUN: Record<GeoLevel, string> = {
  national: "national",
  region: "region",
  province: "province",
  citymun: "city/municipality",
  barangay: "barangay",
};

/** Minimum profiled BHWs a child geo needs before it can be crowned a leader,
 * laggard, or spread endpoint — a 3-person barangay at "100% accredited" is
 * noise, not an insight. Mirrors (more conservatively) the n<5 suppression
 * convention used by agg_demographics/agg_honorarium. */
export const MIN_LEADER_N = 30;

/** Minimum qualifying children before spread/laggard superlatives make sense —
 * "the widest gap among 2 provinces" or "the worst of 2" is a coin flip. */
export const MIN_RANKED_CHILDREN = 4;

/** A top-vs-bottom accreditation gap below this many points isn't worth a card. */
export const MIN_SPREAD_GAP = 5;

/** Cards shown per grid — two full rows at the grid's 3-column breakpoint. */
export const MAX_CARDS = 6;

export type ChildSummary = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  nTotal: number | null;
  pctAccredited: number | null;
  anyHonorariumPct: number | null;
};

/**
 * Shared inputs for every generator applicable at the current level. The
 * `Promise`-returning fields are lazy and memoized — each backing query runs
 * at most once per `getInsights` call, and only if some generator awaits it.
 */
type InsightContext = {
  geoLevel: GeoLevel;
  geoCode: string;
  geoName: string;
  /** Nearest ancestor one level up (national is a synthetic "Philippines"
   * entry for regions; NCR-style gaps fall through to the next ancestor). */
  parent: GeoOption | null;
  ancestors: GeoAncestors;
  childSummaries: () => Promise<ChildSummary[]>;
  selfCounts: () => Promise<BhwCounts | null>;
  parentCounts: () => Promise<BhwCounts | null>;
  stepzero: () => Promise<StepzeroCounts | null>;
};

type InsightGenerator = {
  id: string;
  /** Geo levels at which this insight is meaningful. Selection principle:
   * insights are *relational* (rankings, gaps, deviations from parent) or
   * surface data the page's own figures don't already show at that level. */
  levels: readonly GeoLevel[];
  generate: (ctx: InsightContext) => Promise<InsightCard | null>;
};

/* ------------------------------------------------------------------------- *
 * Pure helpers (exported for unit tests)
 * ------------------------------------------------------------------------- */

/** Children eligible for superlatives — metric present and n over the leader
 * threshold — sorted best-first by the metric. */
export function rankChildren(
  rows: ChildSummary[],
  metric: (r: ChildSummary) => number | null,
): ChildSummary[] {
  return rows
    .filter((r) => metric(r) !== null && (r.nTotal ?? 0) >= MIN_LEADER_N)
    .sort((a, b) => (metric(b) as number) - (metric(a) as number));
}

/** Top/bottom endpoints of a ranked child list, when there are enough children
 * and the (rounded) gap between them is wide enough to be a story. */
export function spreadOf(
  ranked: ChildSummary[],
  metric: (r: ChildSummary) => number | null,
): { top: ChildSummary; bottom: ChildSummary; gap: number } | null {
  if (ranked.length < MIN_RANKED_CHILDREN) return null;
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const gap = Math.round(metric(top) as number) - Math.round(metric(bottom) as number);
  if (gap < MIN_SPREAD_GAP) return null;
  return { top, bottom, gap };
}

/** Own-vs-parent percentages rounded for display, with the diff computed on
 * the rounded values so the headline never says "33% vs 33% — 0.4 points below". */
export function benchmarkDiff(
  own: number | null | undefined,
  parent: number | null | undefined,
): { own: number; parent: number; diff: number } | null {
  if (own == null || parent == null) return null;
  const roundedOwn = Math.round(own);
  const roundedParent = Math.round(parent);
  return { own: roundedOwn, parent: roundedParent, diff: roundedOwn - roundedParent };
}

/** Highest-scoring cards first (stable on ties, preserving registry order),
 * capped to the grid size. */
export function pickTopInsights(cards: InsightCard[], max: number = MAX_CARDS): InsightCard[] {
  return [...cards].sort((a, b) => b.score - a.score).slice(0, max);
}

function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString()}`;
}

function pointsPhrase(diff: number): string {
  const n = Math.abs(diff);
  return `${n} point${n === 1 ? "" : "s"} ${diff > 0 ? "above" : "below"}`;
}

/* ------------------------------------------------------------------------- *
 * Generators
 * ------------------------------------------------------------------------- */

/** "X leads all provinces on accreditation" — child leaderboard. Stops at
 * province: ranking barangays within a citymun is where small-n noise is
 * worst, so citymun and below get self/benchmark insights instead. */
const accreditationLeader: InsightGenerator = {
  id: "accreditation-leader",
  levels: ["national", "region", "province"],
  async generate(ctx) {
    const ranked = rankChildren(await ctx.childSummaries(), (r) => r.pctAccredited);
    const top = ranked[0];
    if (!top) return null;
    const scopeSuffix = ctx.geoLevel === "national" ? "" : ` in ${ctx.geoName}`;
    return {
      id: this.id,
      category: "Accreditation",
      headline: `${top.geoName} leads all ${LEVEL_NOUN[top.geoLevel]}s${scopeSuffix} on BHW accreditation, at ${Math.round(top.pctAccredited as number)}%.`,
      caption: `N = ${top.nTotal?.toLocaleString() ?? "—"} BHWs · ${top.geoName} · 2025 snapshot`,
      href: `/place/${top.geoLevel}/${top.geoCode}`,
      score: 60,
    };
  },
};

/** Top-vs-bottom accreditation gap among children — the inequity headline. */
const accreditationSpread: InsightGenerator = {
  id: "accreditation-spread",
  levels: ["national", "region", "province"],
  async generate(ctx) {
    const metric = (r: ChildSummary) => r.pctAccredited;
    const ranked = rankChildren(await ctx.childSummaries(), metric);
    const spread = spreadOf(ranked, metric);
    if (!spread) return null;
    const noun = LEVEL_NOUN[spread.top.geoLevel];
    const scopeSuffix = ctx.geoLevel === "national" ? "" : ` in ${ctx.geoName}`;
    return {
      id: this.id,
      category: "Equity",
      headline: `Accreditation ranges from ${Math.round(metric(spread.bottom) as number)}% in ${spread.bottom.geoName} to ${Math.round(metric(spread.top) as number)}% in ${spread.top.geoName} — a ${spread.gap}-point gap between ${noun}s${scopeSuffix}.`,
      caption: `${ranked.length} ${noun}s compared · ${ctx.geoName} · 2025 snapshot`,
      score: 50 + Math.min(spread.gap, 40) / 2,
    };
  },
};

/** The child at the bottom of the accreditation ranking — the actionable
 * counterpart to the leader card for program managers. */
const accreditationLaggard: InsightGenerator = {
  id: "accreditation-laggard",
  levels: ["region", "province"],
  async generate(ctx) {
    const ranked = rankChildren(await ctx.childSummaries(), (r) => r.pctAccredited);
    if (ranked.length < MIN_RANKED_CHILDREN) return null;
    const bottom = ranked[ranked.length - 1];
    return {
      id: this.id,
      category: "Priority",
      headline: `${bottom.geoName} has the lowest BHW accreditation of any ${LEVEL_NOUN[bottom.geoLevel]} in ${ctx.geoName}, at ${Math.round(bottom.pctAccredited as number)}%.`,
      caption: `N = ${bottom.nTotal?.toLocaleString() ?? "—"} BHWs · ${bottom.geoName} · 2025 snapshot`,
      href: `/place/${bottom.geoLevel}/${bottom.geoCode}`,
      score: 45,
    };
  },
};

/** Own accreditation vs the parent's — the one card every sub-national level
 * gets that no on-page figure shows. Scores up with the size of the deviation. */
const accreditationVsParent: InsightGenerator = {
  id: "accreditation-vs-parent",
  levels: ["region", "province", "citymun", "barangay"],
  async generate(ctx) {
    if (!ctx.parent) return null;
    const [self, parent] = await Promise.all([ctx.selfCounts(), ctx.parentCounts()]);
    const cmp = benchmarkDiff(self?.pctAccredited, parent?.pctAccredited);
    if (!cmp) return null;
    const reference =
      ctx.parent.geoLevel === "national"
        ? `the national rate of ${cmp.parent}%`
        : `${ctx.parent.geoName}'s ${cmp.parent}%`;
    const comparison =
      Math.abs(cmp.diff) < 1
        ? `on par with ${reference}`
        : `${pointsPhrase(cmp.diff)} ${reference}`;
    return {
      id: this.id,
      category: "Benchmark",
      headline: `Accreditation in ${ctx.geoName} stands at ${cmp.own}% — ${comparison}.`,
      caption: `N = ${self?.nTotal?.toLocaleString() ?? "—"} BHWs · ${ctx.geoName} · 2025 snapshot`,
      href:
        ctx.parent.geoLevel === "national"
          ? undefined
          : `/place/${ctx.parent.geoLevel}/${ctx.parent.geoCode}`,
      score: Math.abs(cmp.diff) < 1 ? 40 : 55 + Math.min(Math.abs(cmp.diff), 25),
    };
  },
};

/** Largest child workforce by headcount. At the national level provinces
 * (rather than regions, which the other leader cards use) give headline
 * variety — preserved from the original generator. */
const geographySize: InsightGenerator = {
  id: "geography-size",
  levels: ["national", "region", "province"],
  async generate(ctx) {
    if (ctx.geoLevel === "national") {
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
        id: this.id,
        category: "Geography",
        headline: `${data.geo_name} has more registered BHWs than any other province, at ${data.n_total?.toLocaleString()}.`,
        caption: `N = ${data.n_total?.toLocaleString() ?? "—"} BHWs · ${data.geo_name} · 2025 snapshot`,
        href: `/place/province/${data.geo_code}`,
        score: 45,
      };
    }

    const rows = (await ctx.childSummaries()).filter((r) => r.nTotal !== null);
    const top = rows.sort((a, b) => (b.nTotal as number) - (a.nTotal as number))[0];
    if (!top) return null;
    return {
      id: this.id,
      category: "Geography",
      headline: `${top.geoName} has more registered BHWs than any other ${LEVEL_NOUN[top.geoLevel]} in ${ctx.geoName}, at ${top.nTotal?.toLocaleString()}.`,
      caption: `N = ${top.nTotal?.toLocaleString() ?? "—"} BHWs · ${top.geoName} · 2025 snapshot`,
      href: `/place/${top.geoLevel}/${top.geoCode}`,
      score: 45,
    };
  },
};

/** Lowest-coverage training topic. Barangays have no per-topic rows
 * (agg_training stops at citymun — see getTrainingCoverage), so they fall
 * back to the citymun ancestor with explicit attribution, matching the
 * TrainingFigure's fallback behavior. */
const trainingGap: InsightGenerator = {
  id: "training-gap",
  levels: ["national", "region", "province", "citymun", "barangay"],
  async generate(ctx) {
    const fallback = ctx.geoLevel === "barangay" ? ctx.ancestors.citymun : null;
    if (ctx.geoLevel === "barangay" && !fallback) return null;
    const target = fallback ?? {
      geoCode: ctx.geoCode,
      geoLevel: ctx.geoLevel,
      geoName: ctx.geoName,
    };

    const rows = await getTrainingCoverage(target.geoCode, target.geoLevel);
    const worst = rows.find((r) => r.coveragePct !== null && r.topicLabel !== null);
    if (!worst) return null;
    const pct = Math.round(worst.coveragePct as number);
    const scope =
      ctx.geoLevel === "national"
        ? "the nation's"
        : fallback
          ? `${fallback.geoName}'s`
          : `${ctx.geoName}'s`;
    return {
      id: this.id,
      category: "Training",
      headline: `"${worst.topicLabel}" is ${scope} biggest training gap, at just ${pct}% coverage.`,
      caption: fallback
        ? `City/municipality-level data · ${fallback.geoName} · 2025 snapshot`
        : `N = ${worst.nTotal?.toLocaleString() ?? "—"} BHWs · ${ctx.geoName} · 2025 snapshot`,
      score: 50 + Math.round((100 - pct) / 5),
    };
  },
};

/** Child with the widest honorarium coverage. National/region only — from
 * province down, the amount card below is the more informative honorarium story. */
const honorariumLeader: InsightGenerator = {
  id: "honorarium-leader",
  levels: ["national", "region"],
  async generate(ctx) {
    const ranked = rankChildren(await ctx.childSummaries(), (r) => r.anyHonorariumPct);
    const top = ranked[0];
    if (!top) return null;
    const scope =
      ctx.geoLevel === "national"
        ? "any region"
        : `any ${LEVEL_NOUN[top.geoLevel]} in ${ctx.geoName}`;
    return {
      id: this.id,
      category: "Honorarium",
      headline: `${Math.round(top.anyHonorariumPct as number)}% of BHWs in ${top.geoName} receive some form of honorarium — the highest of ${scope}.`,
      caption: `N = ${top.nTotal?.toLocaleString() ?? "—"} BHWs · ${top.geoName} · 2025 snapshot`,
      href: `/place/${top.geoLevel}/${top.geoCode}`,
      score: 45,
    };
  },
};

const PAYER_NOUN: Record<string, string> = {
  region: "region",
  province: "province",
  citymun: "city/municipality",
  barangay: "barangay",
};

/** Typical peso amount from the most common paying level — uses the
 * distribution stats in agg_honorarium and respects its small-n suppression. */
const honorariumAmount: InsightGenerator = {
  id: "honorarium-amount",
  levels: ["province", "citymun", "barangay"],
  async generate(ctx) {
    const rows = await getHonorarium(ctx.geoCode, ctx.geoLevel);
    const usable = rows.filter(
      (r) =>
        !r.isSuppressed && r.medianAmount !== null && r.nReceiving !== null && r.nReceiving > 0,
    );
    const top = usable.sort((a, b) => (b.nReceiving as number) - (a.nReceiving as number))[0];
    if (!top) return null;
    const payer = PAYER_NOUN[top.payerLevel] ?? top.payerLevel;
    return {
      id: this.id,
      category: "Honorarium",
      headline: `Honorarium from the ${payer} is the most common in ${ctx.geoName} — a median of ${formatPeso(top.medianAmount as number)} per month.`,
      caption: `N = ${top.nReceiving?.toLocaleString() ?? "—"} recipients · ${ctx.geoName} · 2025 snapshot`,
      score: 55,
    };
  },
};

/** Reference Manual training vs TESDA NC II certification — agg_certification
 * is built at all 5 levels, so this works even where agg_training doesn't.
 * Citymun/barangay only: the national/region/province views already surface
 * certification through their own figures. */
const certificationGap: InsightGenerator = {
  id: "certification-gap",
  levels: ["citymun", "barangay"],
  async generate(ctx) {
    const rows = await getCertification(ctx.geoCode, ctx.geoLevel);
    const byType = new Map(rows.map((r) => [r.certType, r]));
    const refManual = byType.get("ref_manual_trained");
    const certified = byType.get("tesda_certified");
    if (refManual?.pct == null || certified?.pct == null) return null;
    const refPct = Math.round(refManual.pct);
    const certPct = Math.round(certified.pct);
    const conjunction = certPct < refPct ? "but only" : "and";
    return {
      id: this.id,
      category: "Certification",
      headline: `${refPct}% of BHWs in ${ctx.geoName} have BHW Reference Manual training, ${conjunction} ${certPct}% hold TESDA BHS NC II certification.`,
      caption: `Validated profiles · ${ctx.geoName} · 2025 snapshot`,
      score: 50,
    };
  },
};

/** Average years of service vs the parent's — comparative framing the place
 * page's standalone service-years figure can't provide. */
const serviceTenure: InsightGenerator = {
  id: "service-tenure",
  levels: ["citymun", "barangay"],
  async generate(ctx) {
    if (!ctx.parent) return null;
    const [self, parent] = await Promise.all([ctx.selfCounts(), ctx.parentCounts()]);
    if (self?.avgActiveYears == null || parent?.avgActiveYears == null) return null;
    const oneDecimal = (n: number) => Math.round(n * 10) / 10;
    return {
      id: this.id,
      category: "Service tenure",
      headline: `BHWs in ${ctx.geoName} have served an average of ${oneDecimal(self.avgActiveYears)} years — vs ${oneDecimal(parent.avgActiveYears)} years across ${ctx.parent.geoName}.`,
      caption: `N = ${self.nTotal?.toLocaleString() ?? "—"} BHWs · ${ctx.geoName} · 2025 snapshot`,
      href: `/place/${ctx.parent.geoLevel}/${ctx.parent.geoCode}`,
      score: 42,
    };
  },
};

/** % HS-grad-or-above. Sub-national only: the home page's education tile
 * already reports the identical national figure. */
const educationAttainment: InsightGenerator = {
  id: "education-attainment",
  levels: ["region", "province", "citymun", "barangay"],
  async generate(ctx) {
    const rows = await getDemographics(ctx.geoCode, ctx.geoLevel, ["education"]);
    const pct = hsGradOrAbovePct(rows);
    if (pct === null) return null;
    return {
      id: this.id,
      category: "Education",
      headline: `${pct}% of validated BHW profiles in ${ctx.geoName} are high school graduates or higher.`,
      caption: `Educational attainment · ${ctx.geoName} · 2025 snapshot`,
      href: `/explore?geoLevel=${ctx.geoLevel}&geoCode=${ctx.geoCode}&breakdowns=education`,
      score: 35,
    };
  },
};

/** Non-registered BHWs from the StepZero quick count — a segment no on-page
 * figure surfaces below the home page. Scores up with the non-registered share. */
const registrationGap: InsightGenerator = {
  id: "registration-gap",
  levels: ["citymun", "barangay"],
  async generate(ctx) {
    const sz = await ctx.stepzero();
    if (!sz || sz.nNonRegistered == null || sz.nNonRegistered <= 0) return null;
    if (sz.nTotalBhw == null || sz.nTotalBhw <= 0) return null;
    const share = sz.nNonRegistered / sz.nTotalBhw;
    return {
      id: this.id,
      category: "Registration",
      headline: `${sz.nNonRegistered.toLocaleString()} of the ${sz.nTotalBhw.toLocaleString()} BHWs serving ${ctx.geoName} are not yet registered.`,
      caption: `LGU-declared headcount · ${ctx.geoName} · StepZero quick count`,
      score: 40 + Math.round(30 * Math.min(share, 1)),
    };
  },
};

/** Households per BHW at barangay scale — the assignment-level view of the
 * same ratio the overview strip shows for every geo. */
const householdCoverage: InsightGenerator = {
  id: "household-coverage",
  levels: ["barangay"],
  async generate(ctx) {
    const sz = await ctx.stepzero();
    const ratio = householdsPerBhw(sz?.households ?? null, sz?.nTotalBhw ?? null);
    if (sz === null || ratio === null) return null;
    return {
      id: this.id,
      category: "Coverage",
      headline: `${ctx.geoName} has roughly 1 BHW for every ${ratio.toLocaleString()} households.`,
      caption: `${sz.households?.toLocaleString()} households · ${sz.nTotalBhw?.toLocaleString()} BHWs · StepZero quick count`,
      score: 40,
    };
  },
};

/** Registry order is the tie-break when scores are equal, so keep it in
 * rough editorial priority. */
const INSIGHT_GENERATORS: InsightGenerator[] = [
  accreditationLeader,
  accreditationVsParent,
  accreditationSpread,
  accreditationLaggard,
  trainingGap,
  honorariumLeader,
  honorariumAmount,
  certificationGap,
  geographySize,
  serviceTenure,
  registrationGap,
  householdCoverage,
  educationAttainment,
];

const CHILD_SUMMARY_FIELDS =
  "geo_code, geo_level, geo_name, n_total, pct_accredited, any_honorarium_pct";

async function fetchChildSummaries(geoCode: string, geoLevel: GeoLevel): Promise<ChildSummary[]> {
  const datasetId = await getActiveDatasetId();
  if (datasetId === null) return [];
  const children = await getChildGeos(geoCode, geoLevel);
  if (children.length === 0) return [];

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("agg_geo_summary")
    .select(CHILD_SUMMARY_FIELDS)
    .eq("dataset_id", datasetId)
    .eq("geo_level", children[0].geoLevel)
    .in(
      "geo_code",
      children.map((c) => c.geoCode),
    );

  return (data ?? []).map((row) => ({
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    geoName: row.geo_name,
    nTotal: row.n_total,
    pctAccredited: row.pct_accredited,
    anyHonorariumPct: row.any_honorarium_pct,
  }));
}

/** Memoizes an async fetch so shared context inputs hit the DB at most once. */
function lazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= fn());
}

const NO_ANCESTORS: GeoAncestors = { region: null, province: null, citymun: null };

function resolveParent(geoLevel: GeoLevel, ancestors: GeoAncestors): GeoOption | null {
  switch (geoLevel) {
    case "national":
      return null;
    case "region":
      return {
        geoCode: NATIONAL_GEO_CODE,
        geoLevel: "national",
        geoName: "Philippines",
        incomeClass: null,
      };
    case "province":
      return ancestors.region;
    case "citymun":
      // NCR cities have no province ancestor — benchmark against the region.
      return ancestors.province ?? ancestors.region;
    case "barangay":
      return ancestors.citymun ?? ancestors.province ?? ancestors.region;
  }
}

/**
 * Level-aware insight grid for one geo. Each geo level runs its own subset of
 * generators (see each generator's `levels`), sharing lazily-fetched inputs
 * through `InsightContext`; the resulting cards are curated to the top
 * `MAX_CARDS` by noteworthiness score. Generators are independent — one
 * failing or returning null just drops its card.
 */
export async function getInsights(
  geoLevel: GeoLevel,
  geoCode: string,
  geoName: string,
): Promise<InsightCard[]> {
  const applicable = INSIGHT_GENERATORS.filter((g) => g.levels.includes(geoLevel));
  const ancestors =
    geoLevel === "national" ? NO_ANCESTORS : await getGeoAncestors(geoCode, geoLevel);
  const parent = resolveParent(geoLevel, ancestors);

  const ctx: InsightContext = {
    geoLevel,
    geoCode,
    geoName,
    parent,
    ancestors,
    childSummaries: lazy(() => fetchChildSummaries(geoCode, geoLevel)),
    selfCounts: lazy(() => getBhwCounts(geoCode, geoLevel)),
    parentCounts: lazy(() =>
      parent ? getBhwCounts(parent.geoCode, parent.geoLevel) : Promise.resolve(null),
    ),
    stepzero: lazy(() => getStepzeroCounts(geoCode, geoLevel)),
  };

  const results = await Promise.all(applicable.map((g) => g.generate(ctx).catch(() => null)));
  return pickTopInsights(results.filter((r): r is InsightCard => r !== null));
}

/** Home page convenience wrapper — always national. */
export async function getHomeInsights(): Promise<InsightCard[]> {
  return getInsights("national", NATIONAL_GEO_CODE, "Philippines");
}
