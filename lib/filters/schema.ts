import { z } from "zod";

export const GEO_LEVELS = ["national", "region", "province", "citymun", "barangay"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export const INDICATORS = [
  "accreditation",
  "demographics",
  "training",
  "certification",
  "honorarium",
  "honorarium_amount",
  "honorarium_distribution",
  "service_years",
] as const;
export type Indicator = (typeof INDICATORS)[number];

/**
 * Indicators the Explore map + ranked list can colour by (E1.1). The five base
 * indicators are fixed enum values; per-topic training coverage is expressed as
 * `training:<topic_slug>` so any ingested training topic is addressable without
 * enumerating them here. `mapIndicator` is its own URL param, separate from the
 * per-theme `indicator` above.
 */
export const MAP_BASE_INDICATORS = [
  "pct_accredited",
  "any_honorarium_pct",
  "households_per_bhw",
  "avg_active_years",
  "coverage_pct",
  "bhw_per_1000",
] as const;
export type MapBaseIndicator = (typeof MAP_BASE_INDICATORS)[number];

/** A base indicator, or a per-topic training indicator `training:<topic_slug>`. */
export type MapIndicator = MapBaseIndicator | `training:${string}`;

export const DEFAULT_MAP_INDICATOR: MapBaseIndicator = "pct_accredited";

/** Default axes for the relationships scatter (E1.4): load vs accreditation. */
export const DEFAULT_REL_X: MapBaseIndicator = "households_per_bhw";
export const DEFAULT_REL_Y: MapBaseIndicator = "pct_accredited";

export const mapBaseIndicatorSchema = z.enum(MAP_BASE_INDICATORS);

const MAP_TRAINING_PREFIX = "training:";
/** Topic slugs are lower-kebab (`maternal-health`), matching `agg_training.topic_slug`. */
const TOPIC_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The `<topic_slug>` of a `training:` indicator, or null for base indicators. */
export function mapIndicatorTopicSlug(indicator: MapIndicator): string | null {
  return indicator.startsWith(MAP_TRAINING_PREFIX)
    ? indicator.slice(MAP_TRAINING_PREFIX.length)
    : null;
}

/** Build a `training:<slug>` indicator value from a topic slug. */
export function trainingMapIndicator(topicSlug: string): MapIndicator {
  return `${MAP_TRAINING_PREFIX}${topicSlug}`;
}

/**
 * Coerce any raw string to a valid `MapIndicator`, falling back to the default
 * accreditation view for anything unrecognised (an unknown base value or a
 * malformed `training:` slug) — permalinks never throw, they degrade, matching
 * the rest of the filter codec.
 */
export function normalizeMapIndicator(raw: string | null | undefined): MapIndicator {
  if (!raw) return DEFAULT_MAP_INDICATOR;
  if ((MAP_BASE_INDICATORS as readonly string[]).includes(raw)) return raw as MapBaseIndicator;
  if (raw.startsWith(MAP_TRAINING_PREFIX)) {
    const slug = raw.slice(MAP_TRAINING_PREFIX.length);
    if (TOPIC_SLUG_RE.test(slug)) return raw as MapIndicator;
  }
  return DEFAULT_MAP_INDICATOR;
}

export const DEMOGRAPHIC_DIMENSIONS = [
  "sex",
  "age_band",
  "civil_status",
  "bloodtype",
  "education",
  "ip_status",
] as const;
export type DemographicDimension = (typeof DEMOGRAPHIC_DIMENSIONS)[number];

/** Sentinel `dim_geo.geo_code` for the national (`geo_level = 'national'`) roll-up row. */
export const NATIONAL_GEO_CODE = "PH";

export const geoLevelSchema = z.enum(GEO_LEVELS);
export const indicatorSchema = z.enum(INDICATORS);
export const demographicDimensionSchema = z.enum(DEMOGRAPHIC_DIMENSIONS);

export const filterStateSchema = z.object({
  geoLevel: geoLevelSchema.catch("national"),
  geoCode: z
    .string()
    .min(1)
    .catch(NATIONAL_GEO_CODE)
    .transform((v) => (v.length === 0 ? NATIONAL_GEO_CODE : v)),
  indicator: indicatorSchema.nullable().catch(null),
  mapIndicator: z
    .string()
    .catch(DEFAULT_MAP_INDICATOR)
    .transform(normalizeMapIndicator),
  relX: mapBaseIndicatorSchema.catch(DEFAULT_REL_X),
  relY: mapBaseIndicatorSchema.catch(DEFAULT_REL_Y),
  compareGeos: z
    .array(z.string().min(1))
    .max(4)
    .nullable()
    .catch(null),
  breakdowns: z.array(demographicDimensionSchema).nullable().catch(null),
});

export type FilterState = z.infer<typeof filterStateSchema>;

/** Breakdowns shown on /explore when the URL doesn't specify any. */
export const DEFAULT_BREAKDOWNS: DemographicDimension[] = ["sex", "age_band"];

export const defaultFilterState: FilterState = filterStateSchema.parse({
  geoLevel: "national",
  geoCode: NATIONAL_GEO_CODE,
  indicator: null,
  mapIndicator: DEFAULT_MAP_INDICATOR,
  relX: DEFAULT_REL_X,
  relY: DEFAULT_REL_Y,
  compareGeos: null,
  breakdowns: null,
});
