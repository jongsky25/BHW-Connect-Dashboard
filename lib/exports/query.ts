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

export function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
