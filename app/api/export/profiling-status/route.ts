import { NextResponse } from "next/server";
import { z } from "zod";
import { geoLevelSchema } from "@/lib/filters/schema";
import { slugify } from "@/lib/exports/query";
import {
  buildProfilingStatusFigure,
  renderProfilingStatusPng,
} from "@/lib/exports/profiling-status-figure";

export const runtime = "nodejs";

const querySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
});

/** One-page PNG summary of the 2026 BHW profiling status for a chosen geo level:
 * header + meta, the Encode → Validate → Certify funnel, a child-unit breakdown, and bars. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  const figure = await buildProfilingStatusFigure(parsed.data.geoCode, parsed.data.geoLevel);
  if (!figure) {
    return NextResponse.json({ error: "No profiling status for this area" }, { status: 404 });
  }

  const png = await renderProfilingStatusPng(figure);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slugify(...figure.filenameParts)}.png"`,
    },
  });
}
