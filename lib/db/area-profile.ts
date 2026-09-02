import "server-only";
import { executeSearchDocuments, type DocumentHit } from "@/lib/ai/search-documents";
import { MAP_BASE_INDICATORS, type GeoLevel } from "@/lib/filters/schema";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { DEFAULT_BREAKDOWNS } from "@/lib/filters/schema";
import { applyComplementarySuppression, type SuppressedCell } from "./area-profile-suppression";
import { getHonorariumSufficiency, type HonorariumSufficiencyRow } from "./derived-figures";
import { getGeoAncestors, getGeoByCode, type GeoAncestors } from "./geo";
import {
  getBhwCounts,
  getDemographics,
  getHonorarium,
  getTrainingCoverage,
  type BhwCounts,
  type DemographicRow,
  type HonorariumRow,
  type TrainingRow,
} from "./indicators";
import { getPeerRanks, type PeerRank } from "./peer-ranks";
import { getCensusPopulation2024 } from "./population";
import { getChildPoverty, type PovertyPoint } from "./poverty";
import { getProfilingStatus, type ProfilingStatus } from "./profiling-status";
import { getBhwOverview, type BhwOverview } from "./stepzero";
import { getUucPhcCounts, type UucPhcCounts } from "./uuc-phc";
import { getUucBhwCoverage, type UucBhwCoverage } from "./uuc-phc-bhw-coverage";
import { getUucPhcCriteria, type UucPhcCriteria } from "./uuc-phc-criteria";

/**
 * The consolidated area profile (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.4): every dataset that
 * covers one place, in one payload — and, just as deliberately, **every dataset that does not,
 * with the reason**.
 *
 * The coverage map is the point, not a courtesy. Six datasets describe a geography and each stops
 * at a different level: training is not built at barangay, honorarium sufficiency is null there,
 * peer ranks exist only for regions/provinces/cities, poverty is city/municipality grain only.
 * Returning `null` for all of those makes them indistinguishable from "this place has no data",
 * which is what a reader — and a model — will report. `not-built-at-this-level` and `no-data` are
 * different findings, and telling them apart is this module's main correctness requirement.
 *
 * Nothing here throws. Every source already degrades to `null`/`[]` when its dataset is absent
 * (each is gated on `getActiveDatasetId()`/`getDatasetIdBySlug()`), and each call is additionally
 * caught, so one unavailable table costs one section rather than the profile.
 */

export type SourceState = "present" | "suppressed" | "not-built-at-this-level" | "no-data";

export type ProfileSection<T> = {
  state: SourceState;
  /** Why, whenever the state is not `present`. Null only when there is data to show. */
  reason: string | null;
  data: T | null;
};

export type ProfileDemographics = {
  rows: SuppressedCell<DemographicRow>[];
  /** Dimensions whose suppressed cell is still derivable from the published total. */
  unprotectable: string[];
  notes: string[];
};

export type AreaProfile = {
  geo: { geoCode: string; geoLevel: GeoLevel; geoName: string };
  ancestors: GeoAncestors;
  sections: {
    bhwOverview: ProfileSection<BhwOverview>;
    bhwCounts: ProfileSection<BhwCounts>;
    demographics: ProfileSection<ProfileDemographics>;
    training: ProfileSection<TrainingRow[]>;
    honorarium: ProfileSection<HonorariumRow[]>;
    honorariumSufficiency: ProfileSection<HonorariumSufficiencyRow>;
    profilingStatus: ProfileSection<ProfilingStatus>;
    uucPhcCounts: ProfileSection<UucPhcCounts>;
    uucPhcCriteria: ProfileSection<UucPhcCriteria>;
    uucBhwCoverage: ProfileSection<UucBhwCoverage>;
    poverty: ProfileSection<PovertyPoint>;
    population: ProfileSection<number>;
    peerRanks: ProfileSection<Record<string, PeerRank>>;
    documents: ProfileSection<DocumentHit[]>;
  };
  /** Everything the reader must be told before quoting a figure from this payload. */
  warnings: string[];
};

const present = <T>(data: T): ProfileSection<T> => ({ state: "present", reason: null, data });
const absent = <T>(state: Exclude<SourceState, "present">, reason: string): ProfileSection<T> => ({
  state,
  reason,
  data: null,
});

/** Run a source, degrading a thrown error to the same shape as no data (§1: degrade, never error). */
function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  return load().catch(() => fallback);
}

/** Levels `agg_peer_ranks` covers — see `PEER_LEVEL_PLURAL`. */
const RANKED_LEVELS: readonly GeoLevel[] = ["region", "province", "citymun"];

/** Takes no level: the caller's is a hint, and the row's is authoritative — see `getAreaProfile`. */
async function resolveGeo(
  geoCode: string,
): Promise<{ geoCode: string; geoLevel: GeoLevel; geoName: string } | null> {
  if (geoCode === NATIONAL_GEO_CODE) {
    return { geoCode: NATIONAL_GEO_CODE, geoLevel: "national", geoName: "Philippines" };
  }
  const geo = await safely(() => getGeoByCode(geoCode), null);
  // The caller's `geoLevel` is not trusted over the row's: a mismatched level silently queries
  // aggregates at a grain this geography does not have, and every section then reads "no data".
  return geo ? { geoCode: geo.geoCode, geoLevel: geo.geoLevel, geoName: geo.geoName } : null;
}

/**
 * Assemble every dataset that covers one geography, plus the coverage map of those that do not.
 *
 * Returns null when `geoLevel` disagrees with the level `dim_geo` records for `geoCode`, the same
 * check `app/uuc-phc/[geoLevel]/[geoCode]` makes. Silently preferring the row would answer a
 * different question than the one asked — every aggregate is keyed on (geo_code, geo_level), so a
 * mismatched level makes each section read "no data", which is a wrong answer wearing the shape of
 * a finding.
 */
export async function getAreaProfile(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<AreaProfile | null> {
  const geo = await resolveGeo(geoCode);
  if (!geo || geo.geoLevel !== geoLevel) return null;
  const level = geo.geoLevel;

  const [
    ancestors,
    overview,
    counts,
    demographicRows,
    training,
    honorarium,
    sufficiency,
    profiling,
    uucCounts,
    uucCriteria,
    uucCoverage,
    povertyMap,
    population,
    peerRankMap,
    documents,
  ] = await Promise.all([
    safely(() => getGeoAncestors(geo.geoCode, level), {
      region: null,
      province: null,
      citymun: null,
    } as GeoAncestors),
    safely(() => getBhwOverview(geo.geoCode, level), null),
    safely(() => getBhwCounts(geo.geoCode, level), null),
    safely(() => getDemographics(geo.geoCode, level, [...DEFAULT_BREAKDOWNS]), []),
    safely(() => getTrainingCoverage(geo.geoCode, level), []),
    safely(() => getHonorarium(geo.geoCode, level), []),
    safely(() => getHonorariumSufficiency(geo.geoCode, level), null),
    safely(() => getProfilingStatus(geo.geoCode, level), null),
    safely(() => getUucPhcCounts(geo.geoCode, level), null),
    safely(() => getUucPhcCriteria(geo.geoCode, level), null),
    safely(() => getUucBhwCoverage(geo.geoCode, level), null),
    safely(() => getChildPoverty([geo.geoCode]), new Map<string, PovertyPoint>()),
    safely(() => getCensusPopulation2024(geo.geoCode), null),
    level === "national" || level === "barangay"
      ? Promise.resolve(new Map<string, PeerRank>())
      : safely(() => getPeerRanks(geo.geoCode, level, MAP_BASE_INDICATORS), new Map()),
    // Scoped to this place by name. A miss is a real finding — "no document mentions it" — so it
    // is reported as `no-data` rather than as an error.
    safely(() => executeSearchDocuments({ query: geo.geoName, limit: 4 }), {
      error: "unavailable",
    }),
  ]);

  const warnings: string[] = [];

  // --- Demographics, with the cross-dataset pass (see area-profile-suppression.ts) -------------
  let demographics: ProfileSection<ProfileDemographics>;
  if (demographicRows.length === 0) {
    demographics = absent(
      "no-data",
      `No demographic breakdown rows are recorded for ${geo.geoName}.`,
    );
  } else {
    const result = applyComplementarySuppression(demographicRows);
    const anySuppressed = result.rows.some((r) => r.isSuppressed);
    demographics = {
      state: anySuppressed ? "suppressed" : "present",
      reason: anySuppressed
        ? "Some cells are withheld to protect individuals; see notes for which and why."
        : null,
      data: { rows: result.rows, unprotectable: result.unprotectable, notes: result.notes },
    };
    warnings.push(...result.notes);
  }

  const sections: AreaProfile["sections"] = {
    bhwOverview: overview
      ? present(overview)
      : absent("no-data", `No BHW census overview is recorded for ${geo.geoName}.`),

    bhwCounts: counts
      ? present(counts)
      : absent("no-data", `No validated-profile counts are recorded for ${geo.geoName}.`),

    demographics,

    training:
      level === "barangay"
        ? absent(
            "not-built-at-this-level",
            "Training coverage is built down to city/municipality only — the barangay × topic cross-product is outside the free-tier disk budget. This is a build decision, not missing data.",
          )
        : training.length > 0
          ? present(training)
          : absent("no-data", `No training-coverage rows are recorded for ${geo.geoName}.`),

    honorarium:
      honorarium.length > 0
        ? present(honorarium)
        : absent("no-data", `No honorarium rows are recorded for ${geo.geoName}.`),

    honorariumSufficiency:
      level === "barangay"
        ? absent(
            "not-built-at-this-level",
            "Honorarium sufficiency is not computed at barangay level.",
          )
        : sufficiency
          ? present(sufficiency)
          : absent("no-data", `No honorarium sufficiency row is recorded for ${geo.geoName}.`),

    profilingStatus: profiling
      ? present(profiling)
      : absent("no-data", `The 2026 profiling-status dataset has no row for ${geo.geoName}.`),

    uucPhcCounts: uucCounts
      ? present(uucCounts)
      : absent("no-data", `The UUC for PHC 2025 dataset has no row for ${geo.geoName}.`),

    uucPhcCriteria: uucCriteria
      ? present(uucCriteria)
      : absent(
          "no-data",
          `No UUC for PHC qualifying-route breakdown is recorded for ${geo.geoName}.`,
        ),

    uucBhwCoverage: uucCoverage
      ? present(uucCoverage)
      : absent(
          "no-data",
          `No listed-vs-other BHW coverage comparison is recorded for ${geo.geoName}.`,
        ),

    poverty:
      level === "citymun"
        ? (() => {
            const point = povertyMap.get(geo.geoCode);
            return point
              ? present(point)
              : absent<PovertyPoint>(
                  "no-data",
                  `The PSA small-area poverty estimates have no row for ${geo.geoName} — highly urbanised cities are excluded from that source.`,
                );
          })()
        : absent(
            "not-built-at-this-level",
            "Poverty incidence is a small-area estimate published at city/municipality grain only. It is a rate and is not rolled up, so there is no figure at this level.",
          ),

    population:
      population !== null
        ? present(population)
        : absent("no-data", `No PSA 2024 census population is recorded for ${geo.geoName}.`),

    peerRanks: RANKED_LEVELS.includes(level)
      ? peerRankMap.size > 0
        ? present(Object.fromEntries(peerRankMap))
        : absent("no-data", `${geo.geoName} has no rows in agg_peer_ranks.`)
      : absent(
          "not-built-at-this-level",
          level === "national"
            ? "The national figure has no same-level siblings to be ranked against."
            : "Peer ranking is built down to city/municipality level only; agg_peer_ranks has no barangay rows.",
        ),

    documents:
      "error" in documents
        ? absent("no-data", "Document search was unavailable for this profile.")
        : documents.results.length > 0
          ? present(documents.results)
          : absent("no-data", `No ingested document passage mentions ${geo.geoName} by name.`),
  };

  if (sections.documents.state === "present") {
    warnings.push(
      "Document passages are matched on the place name and may mention it incidentally — read the passage before treating it as being about this geography.",
    );
  }

  return { geo, ancestors, sections, warnings };
}

/** The coverage map: what this profile has, and what it does not, with the reason. */
export function coverageOf(profile: AreaProfile): {
  present: string[];
  suppressed: string[];
  absent: { source: string; state: SourceState; reason: string }[];
} {
  const entries = Object.entries(profile.sections) as [string, ProfileSection<unknown>][];
  return {
    present: entries.filter(([, s]) => s.state === "present").map(([k]) => k),
    suppressed: entries.filter(([, s]) => s.state === "suppressed").map(([k]) => k),
    absent: entries
      .filter(([, s]) => s.state === "not-built-at-this-level" || s.state === "no-data")
      .map(([source, s]) => ({ source, state: s.state, reason: s.reason ?? "" })),
  };
}
