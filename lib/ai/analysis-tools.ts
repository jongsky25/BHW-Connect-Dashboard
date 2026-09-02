import "server-only";
import { z } from "zod";
import { describeCorrelation } from "@/lib/analysis/correlation";
import { MAP_BASE_INDICATOR_META } from "@/lib/analysis/map-indicators";
import { PEER_LEVEL_PLURAL, peerParentName } from "@/lib/analysis/peer-labels";
import { regionalSpread } from "@/lib/analysis/regional-spread";
import { MIN_LEADER_N } from "@/lib/analysis/thresholds";
import { coverageOf, getAreaProfile } from "@/lib/db/area-profile";
import { getBenchmarkContext } from "@/lib/db/benchmark-context";
import { getChildGeos, getGeoByCode } from "@/lib/db/geo";
import { getChildIndicators, type ChildIndicatorRow } from "@/lib/db/indicators";
import { getInsights } from "@/lib/db/insights";
import { getPeerRank } from "@/lib/db/peer-ranks";
import type { BhwCounts } from "@/lib/db/indicators";
import type { BhwOverview } from "@/lib/db/stepzero";
import {
  GEO_LEVELS,
  MAP_BASE_INDICATORS,
  NATIONAL_GEO_CODE,
  geoLevelSchema,
  type GeoLevel,
  type MapBaseIndicator,
} from "@/lib/filters/schema";
import type { Tool } from "./tools";

/**
 * Interpretation tools (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.3).
 *
 * The assistant could already fetch "45.2%" and could not say whether that was good. Everything
 * needed to answer that already existed and no tool exposed it: `agg_peer_ranks` carries the rank,
 * percentile, sibling median and an outlier flag; `lib/analysis/` has spread and correlation; and
 * `lib/db/insights.ts` generates the same ranked cards `/bhw` and `/explore` render.
 *
 * So this adds no schema, no query and no new data — it is a tool surface over code the dashboard
 * already runs, which is what keeps "the number in the answer matches the number on screen" true
 * (`lib/ai/tools.ts`) for interpretation as well as for figures.
 *
 * Every tool states *why* it has nothing rather than returning an empty result. `agg_peer_ranks`
 * has no national row (nothing to be a sibling of) and no barangay rows, and a bare `{}` there
 * reads to a model as "no data exists", which it then reports as a gap in the dataset. The reason
 * is part of the answer.
 */

/** The six indicators `agg_peer_ranks` covers, which is also what `getChildIndicators` returns. */
const indicatorSchema = z.enum(MAP_BASE_INDICATORS);

/** Only these three levels have rows in `agg_peer_ranks` — see `PEER_LEVEL_PLURAL`. */
const RANKED_LEVELS: readonly GeoLevel[] = ["region", "province", "citymun"];

/**
 * Read one indicator off a child row. Written as a lookup rather than a switch so adding a seventh
 * indicator is a compile error here rather than a silent null in an answer.
 */
export const PICK_FROM_CHILD: Record<MapBaseIndicator, (row: ChildIndicatorRow) => number | null> =
  {
    pct_accredited: (r) => r.pctAccredited,
    any_honorarium_pct: (r) => r.anyHonorariumPct,
    households_per_bhw: (r) => r.householdsPerBhw,
    avg_active_years: (r) => r.avgActiveYears,
    coverage_pct: (r) => r.coveragePct,
    bhw_per_1000: (r) => r.bhwPer1000,
  };

type BenchmarkSource = { overview: BhwOverview; counts: BhwCounts | null };

/** The same six indicators read off a benchmark row, so this / region / nation are one comparison. */
export const PICK_FROM_BENCHMARK: Record<
  MapBaseIndicator,
  (source: BenchmarkSource) => number | null
> = {
  pct_accredited: (s) => s.counts?.pctAccredited ?? null,
  any_honorarium_pct: (s) => s.counts?.anyHonorariumPct ?? null,
  households_per_bhw: (s) => s.overview.householdsPerBhw,
  avg_active_years: (s) => s.counts?.avgActiveYears ?? null,
  coverage_pct: (s) => s.overview.profilingCoveragePct,
  bhw_per_1000: (s) => s.overview.bhwPer1000,
};

function indicatorMeta(indicator: MapBaseIndicator) {
  const meta = MAP_BASE_INDICATOR_META[indicator];
  return {
    key: indicator,
    label: meta.label,
    unit: meta.suffix === "%" ? "percent" : "count or ratio",
    denominator: meta.denominator,
  };
}

/** Resolve a geo_code to its dim_geo row, short-circuiting the national sentinel like `isKnownGeo`. */
async function resolveGeo(
  geoCode: string,
): Promise<{ geoCode: string; geoLevel: GeoLevel; geoName: string } | null> {
  if (geoCode === NATIONAL_GEO_CODE) {
    return { geoCode: NATIONAL_GEO_CODE, geoLevel: "national", geoName: "Philippines" };
  }
  const geo = await getGeoByCode(geoCode);
  return geo ? { geoCode: geo.geoCode, geoLevel: geo.geoLevel, geoName: geo.geoName } : null;
}

/**
 * Why this geography has no peer standing, in words the model can pass on. Exported for tests
 * because the *reason* is the load-bearing part: "not ranked" plus a cause is usable in an answer,
 * "not ranked" alone gets reported as missing data.
 */
export function unrankedReason(geoLevel: GeoLevel): string | null {
  if (geoLevel === "national") {
    return "The national figure has no peers to rank against — compare it across years or against a benchmark instead.";
  }
  if (geoLevel === "barangay") {
    return "Peer ranking is built down to city/municipality level only; agg_peer_ranks has no barangay rows, so there is no rank for this geography.";
  }
  return null;
}

const peerContextTool: Tool = {
  definition: {
    name: "getPeerContext",
    description:
      "Put one geography's indicator value in context: its rank among its same-level siblings, its percentile, the sibling median, whether it is flagged an outlier, and the same indicator for its region and for the nation. Call this whenever you are about to state a figure for a single place — a bare number does not tell the reader whether it is high or low. Ranking exists for regions, provinces and cities/municipalities only.",
    parameters: {
      type: "object",
      properties: {
        geoCode: { type: "string", description: "Exact geo_code, or 'PH' for national." },
        geoLevel: { type: "string", enum: [...GEO_LEVELS] },
        indicator: { type: "string", enum: [...MAP_BASE_INDICATORS] },
      },
      required: ["geoCode", "geoLevel", "indicator"],
    },
  },
  async execute(args) {
    const parsed = z
      .object({
        geoCode: z.string().min(1).max(20),
        geoLevel: geoLevelSchema,
        indicator: indicatorSchema,
      })
      .safeParse(args);
    if (!parsed.success) return { error: "Invalid arguments for getPeerContext." };
    const { geoCode, geoLevel, indicator } = parsed.data;

    const geo = await resolveGeo(geoCode);
    if (!geo) return { error: `No geography found for geo_code ${geoCode}.` };

    const [rank, benchmark] = await Promise.all([
      RANKED_LEVELS.includes(geoLevel) ? getPeerRank(geoCode, geoLevel, indicator) : null,
      getBenchmarkContext(geoCode, geoLevel, geo.geoName),
    ]);

    const pick = PICK_FROM_BENCHMARK[indicator];
    const reason = unrankedReason(geoLevel);

    return {
      geo,
      indicator: indicatorMeta(indicator),
      value: pick(benchmark.self),
      peer: rank
        ? {
            ranked: true,
            rankPosition: rank.rankPosition,
            nSiblings: rank.nSiblings,
            siblingPlural: PEER_LEVEL_PLURAL[geoLevel] ?? "peers",
            among: peerParentName(geoLevel, benchmark.ancestors),
            percentile: rank.percentile,
            siblingMedian: rank.median,
            medianAbsoluteDeviation: rank.mad,
            isOutlier: rank.isOutlier,
          }
        : {
            ranked: false,
            reason:
              reason ??
              `agg_peer_ranks has no row for ${geo.geoName} on ${indicator} — say the rank is unavailable rather than estimating one.`,
          },
      benchmark: {
        self: pick(benchmark.self),
        region: benchmark.region
          ? { geoName: benchmark.region.geoName, value: pick(benchmark.region) }
          : null,
        national: benchmark.national ? { value: pick(benchmark.national) } : null,
      },
      adequacy: benchmark.adequacy,
      warnings: benchmark.adequacy.smallSample
        ? [
            `This geography has only ${benchmark.adequacy.n ?? 0} validated profiles (below the ${MIN_LEADER_N}-profile threshold), so its rate is unstable — say so alongside the figure.`,
          ]
        : [],
    };
  },
};

const distributionTool: Tool = {
  definition: {
    name: "getDistribution",
    description:
      "Summarise how one indicator is spread across everything one level inside a place: the range, the highest and lowest children, how many have data, and which have too few profiles to be reliable. Optionally pass a second indicator as `against` to get the rank correlation between the two across those children. Use this for 'which provinces are outliers', 'how uneven is this', and 'does load relate to accreditation' — questions about a set, not about one geography.",
    parameters: {
      type: "object",
      properties: {
        parentCode: {
          type: "string",
          description: "geo_code of the parent to look inside — 'PH' for all regions.",
        },
        indicator: { type: "string", enum: [...MAP_BASE_INDICATORS] },
        against: {
          type: "string",
          enum: [...MAP_BASE_INDICATORS],
          description: "Optional second indicator, to report the rank correlation with the first.",
        },
      },
      required: ["parentCode", "indicator"],
    },
  },
  async execute(args) {
    const parsed = z
      .object({
        parentCode: z.string().min(1).max(20),
        indicator: indicatorSchema,
        against: indicatorSchema.optional(),
      })
      .safeParse(args);
    if (!parsed.success) return { error: "Invalid arguments for getDistribution." };
    const { parentCode, indicator, against } = parsed.data;

    const parent = await resolveGeo(parentCode);
    if (!parent) return { error: `No geography found for geo_code ${parentCode}.` };
    if (parent.geoLevel === "barangay") {
      return {
        error:
          "A barangay has nothing inside it — barangay is the lowest level in dim_geo. Ask about its city/municipality instead.",
      };
    }

    const children = await getChildGeos(parentCode, parent.geoLevel);
    if (children.length === 0) {
      return {
        parent,
        note: `No child geographies are recorded under ${parent.geoName}.`,
        rows: [],
      };
    }

    const rows = await getChildIndicators(children.map((c) => c.geoCode));
    const pick = PICK_FROM_CHILD[indicator];

    const withValue = rows
      .map((row) => ({
        geoCode: row.geoCode,
        geoName: row.geoName,
        value: pick(row),
        nTotal: row.nTotal,
        // The dashboard refuses to crown a leader below this threshold (lib/db/insights.ts); a
        // 3-profile barangay at "100% accredited" is noise, and the model must be told which rows
        // are noise rather than left to rank them.
        smallSample: row.nTotal !== null && row.nTotal < MIN_LEADER_N,
      }))
      .filter((row): row is typeof row & { value: number } => row.value !== null);

    const ranked = [...withValue].sort((a, b) => b.value - a.value);
    const spread = regionalSpread(withValue, (r) => r.value);

    const correlation =
      against && against !== indicator
        ? (() => {
            const other = PICK_FROM_CHILD[against];
            const pairs = rows
              .map((row): [number | null, number | null] => [pick(row), other(row)])
              .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
            return {
              against: indicatorMeta(against),
              // `describeCorrelation` returns `insufficient` below its own n floor rather than a
              // coefficient nobody should quote — pass that through as-is.
              ...describeCorrelation(pairs),
            };
          })()
        : null;

    return {
      parent,
      childLevel: children[0]?.geoLevel ?? null,
      indicator: indicatorMeta(indicator),
      counts: {
        children: children.length,
        withValue: withValue.length,
        missing: children.length - withValue.length,
        smallSample: withValue.filter((r) => r.smallSample).length,
      },
      spread,
      highest: ranked.slice(0, 5),
      lowest: ranked.slice(-5).reverse(),
      correlation,
      warnings: [
        ...(withValue.some((r) => r.smallSample)
          ? [
              `Some children have fewer than ${MIN_LEADER_N} validated profiles and are marked smallSample — do not present them as leaders or laggards.`,
            ]
          : []),
        ...(children.length > withValue.length
          ? [
              `${children.length - withValue.length} of ${children.length} children have no value for this indicator; the range covers only those that do.`,
            ]
          : []),
      ],
    };
  },
};

const insightCardsTool: Tool = {
  definition: {
    name: "getInsightCards",
    description:
      "The same ranked insight cards the /bhw and /explore dashboards show for a geography — the notable leaders, laggards, gaps and benchmark differences already computed for it. Use this to open a broad question about a place before drilling in, so your findings match what the dashboard displays.",
    parameters: {
      type: "object",
      properties: {
        geoCode: { type: "string", description: "Exact geo_code, or 'PH' for national." },
        geoLevel: { type: "string", enum: [...GEO_LEVELS] },
      },
      required: ["geoCode", "geoLevel"],
    },
  },
  async execute(args) {
    const parsed = z
      .object({ geoCode: z.string().min(1).max(20), geoLevel: geoLevelSchema })
      .safeParse(args);
    if (!parsed.success) return { error: "Invalid arguments for getInsightCards." };
    const { geoCode, geoLevel } = parsed.data;

    const geo = await resolveGeo(geoCode);
    if (!geo) return { error: `No geography found for geo_code ${geoCode}.` };

    const cards = await getInsights(geoLevel, geoCode, geo.geoName);
    return {
      geo,
      count: cards.length,
      // `score` is deliberately dropped: it is an editorial rank used to curate the grid and is
      // documented as not shown to users. Handing it to the model invites it to quote a number
      // that means nothing outside the generator.
      cards: cards.map((card) => ({
        category: card.category,
        headline: card.headline,
        caption: card.caption,
        ...(card.href ? { href: card.href } : {}),
      })),
      note:
        cards.length === 0
          ? "No insight card cleared the dashboard's thresholds for this geography — usually too few children with data, or no gap wide enough to be notable."
          : "These are the cards the dashboard itself shows for this geography.",
    };
  },
};

const areaProfileTool: Tool = {
  definition: {
    name: "getAreaProfile",
    description:
      "Every dataset that covers one geography in a single call — BHW census overview and counts, demographics, training, honorarium and its sufficiency, 2026 profiling status, UUC for PHC listing, qualifying routes and BHW coverage, poverty, census population, peer ranks, and any ingested document passage that names the place — together with a coverage list naming every dataset that has NO figure for it and why. Use this to open a broad question about one place, and when reporting, say what is missing as well as what is there: 'not built at this level' is a property of how a dataset was built, not a gap in the data, and the two must not be described the same way.",
    parameters: {
      type: "object",
      properties: {
        geoCode: { type: "string", description: "Exact geo_code, or 'PH' for national." },
        geoLevel: { type: "string", enum: [...GEO_LEVELS] },
      },
      required: ["geoCode", "geoLevel"],
    },
  },
  async execute(args) {
    const parsed = z
      .object({ geoCode: z.string().min(1).max(20), geoLevel: geoLevelSchema })
      .safeParse(args);
    if (!parsed.success) return { error: "Invalid arguments for getAreaProfile." };

    const profile = await getAreaProfile(parsed.data.geoCode, parsed.data.geoLevel);
    if (!profile) return { error: `No geography found for geo_code ${parsed.data.geoCode}.` };

    // The coverage summary rides alongside the sections rather than replacing them: the sections
    // carry the figures, and this is what stops "absent" reading as "zero".
    return { ...profile, coverage: coverageOf(profile) };
  },
};

export function createAnalysisTools(): Tool[] {
  return [peerContextTool, distributionTool, insightCardsTool, areaProfileTool];
}
