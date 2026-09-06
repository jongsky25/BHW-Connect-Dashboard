import { NextResponse } from "next/server";
import { z } from "zod";
import { geoLevelSchema } from "@/lib/filters/schema";
import { slugify } from "@/lib/exports/query";
import { buildNhfrFigure, renderNhfrPng } from "@/lib/exports/nhfr-figure";

export const runtime = "nodejs";

const querySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
});

/** One-page PNG summary of the NHFR health-facility registry for a chosen area: the facility
 * count, barangay coverage, the ownership split, a facility-type table, and either a child-unit
 * breakdown or, for a city/municipality, its facilities other than barangay health stations. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  // The registry publishes nothing at barangay grain — /facilities/barangay/* 404s by design, and
  // agg_nhfr_counts has no barangay rows.
  if (parsed.data.geoLevel === "barangay") {
    return NextResponse.json(
      { error: "Facilities are exported at national, region, province or city/municipality level" },
      { status: 400 },
    );
  }

  const figure = await buildNhfrFigure(parsed.data.geoCode, parsed.data.geoLevel);
  if (!figure) {
    return NextResponse.json({ error: "No facility data for this area" }, { status: 404 });
  }

  const png = await renderNhfrPng(figure);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slugify(...figure.filenameParts)}.png"`,
    },
  });
}
