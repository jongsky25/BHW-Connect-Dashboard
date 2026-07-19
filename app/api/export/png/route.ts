import { NextResponse } from "next/server";
import { getExportFigureData } from "@/lib/exports/figure-data";
import { parseExportQuery, slugify } from "@/lib/exports/query";
import { renderFigurePng } from "@/lib/exports/render-png";

export const runtime = "nodejs";

/** PNG export: same chart-spec code as the on-screen figure, rasterized server-side (no headless browser). */
export async function GET(request: Request) {
  const parsed = parseExportQuery(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  const data = await getExportFigureData(parsed.data);
  if (!data) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const png = await renderFigurePng(data);

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slugify(data.title, data.geoName)}.png"`,
    },
  });
}
