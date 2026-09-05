import { z } from "zod";
import { demographicDimensionSchema, geoLevelSchema, indicatorSchema } from "@/lib/filters/schema";
import { DISTRICT_EXPORT_INDICATORS } from "@/lib/exports/figure-data";

/** Shared query-param contract for every api/export/* route — all stateless, all driven by the same filter shape. */
export const exportQuerySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
  indicator: indicatorSchema,
  dimension: demographicDimensionSchema.optional(),
});

/**
 * D3.3 — "Exports: district CSV/XLSX/PNG/PPTX through the existing /api/export routes." A district
 * export request carries `districtCode` instead of `geoCode`/`geoLevel` (a district isn't a
 * `dim_geo` row, plan §1) and is limited to the 3 indicators `agg_bhw_by_district` actually has.
 */
export const districtExportQuerySchema = z.object({
  districtCode: z.string().min(1),
  indicator: z.enum(DISTRICT_EXPORT_INDICATORS),
});

export type ExportQuery =
  | ({ kind: "geo" } & z.infer<typeof exportQuerySchema>)
  | ({ kind: "district" } & z.infer<typeof districtExportQuerySchema>);

/**
 * Parses either export shape from a request URL. `districtCode` presence decides which schema
 * applies — the two never combine (a district export never also carries a geoCode/geoLevel).
 */
export function parseExportQuery(
  url: string,
): { success: true; data: ExportQuery } | { success: false } {
  const { searchParams } = new URL(url);
  const districtCode = searchParams.get("districtCode");

  if (districtCode !== null) {
    const parsed = districtExportQuerySchema.safeParse({
      districtCode,
      indicator: searchParams.get("indicator"),
    });
    return parsed.success
      ? { success: true, data: { kind: "district", ...parsed.data } }
      : { success: false };
  }

  const parsed = exportQuerySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
    indicator: searchParams.get("indicator"),
    dimension: searchParams.get("dimension") ?? undefined,
  });
  return parsed.success ? { success: true, data: { kind: "geo", ...parsed.data } } : { success: false };
}

/**
 * Increment 5.5. A deck is the single-figure contract with more than one indicator, so the same
 * `getExportFigureData(geoCode, geoLevel, indicator)` call builds every slide and nothing new has
 * to be plumbed. `indicator` (singular) still parses exactly as before, which is what keeps every
 * existing export link — and the PNG/CSV/XLSX routes that share this schema — unchanged.
 *
 * Capped at `MAX_DECK_SLIDES` because each slide rasterises its own PNG through resvg on the
 * request path: the cap is a timeout budget, not a taste judgement.
 */
export const MAX_DECK_SLIDES = 6;

export const exportDeckQuerySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
  indicators: z.array(indicatorSchema).min(1).max(MAX_DECK_SLIDES),
  dimension: demographicDimensionSchema.optional(),
});

/** D3.3 — the deck (PPTX) analog of `districtExportQuerySchema`. */
export const districtExportDeckQuerySchema = z.object({
  districtCode: z.string().min(1),
  indicators: z.array(z.enum(DISTRICT_EXPORT_INDICATORS)).min(1).max(MAX_DECK_SLIDES),
});

export type ExportDeckQuery =
  | ({ kind: "geo" } & z.infer<typeof exportDeckQuerySchema>)
  | ({ kind: "district" } & z.infer<typeof districtExportDeckQuerySchema>);

export function parseExportDeckQuery(
  url: string,
): { success: true; data: ExportDeckQuery } | { success: false } {
  const { searchParams } = new URL(url);
  // `indicators=a,b,c` for a deck; `indicator=a` for the one-slide case this route already served.
  const list = searchParams.get("indicators");
  const indicators = list
    ? [
        ...new Set(
          list
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ]
    : [searchParams.get("indicator")].filter((v): v is string => Boolean(v));

  const districtCode = searchParams.get("districtCode");
  if (districtCode !== null) {
    const parsed = districtExportDeckQuerySchema.safeParse({ districtCode, indicators });
    return parsed.success
      ? { success: true, data: { kind: "district", ...parsed.data } }
      : { success: false };
  }

  const parsed = exportDeckQuerySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
    indicators,
    dimension: searchParams.get("dimension") ?? undefined,
  });
  return parsed.success ? { success: true, data: { kind: "geo", ...parsed.data } } : { success: false };
}

export function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
