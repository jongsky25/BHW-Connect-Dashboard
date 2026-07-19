import { z } from "zod";

export const GEO_LEVELS = ["national", "region", "province", "citymun", "barangay"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export const INDICATORS = [
  "accreditation",
  "demographics",
  "training",
  "honorarium",
  "service_years",
] as const;
export type Indicator = (typeof INDICATORS)[number];

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
  compareGeos: null,
  breakdowns: null,
});
