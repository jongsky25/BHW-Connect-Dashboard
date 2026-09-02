import { z } from "zod";
import { demographicDimensionSchema, geoLevelSchema, indicatorSchema } from "@/lib/filters/schema";

/** Shared query-param contract for every api/export/* route — all stateless, all driven by the same filter shape. */
export const exportQuerySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
  indicator: indicatorSchema,
  dimension: demographicDimensionSchema.optional(),
});

export function parseExportQuery(url: string) {
  const { searchParams } = new URL(url);
  return exportQuerySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
    indicator: searchParams.get("indicator"),
    dimension: searchParams.get("dimension") ?? undefined,
  });
}

/**
 * Increment 5.6. A deck is the single-figure contract with more than one indicator, so the same
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

export function parseExportDeckQuery(url: string) {
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

  return exportDeckQuerySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
    indicators,
    dimension: searchParams.get("dimension") ?? undefined,
  });
}

export function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
