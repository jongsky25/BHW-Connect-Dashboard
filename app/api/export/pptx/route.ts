import PptxGenJS from "pptxgenjs";
import { NextResponse } from "next/server";
import { getDistrictExportFigureData, getExportFigureData } from "@/lib/exports/figure-data";
import { addFigureSlide } from "@/lib/exports/pptx-slide";
import { parseExportDeckQuery, slugify } from "@/lib/exports/query";

export const runtime = "nodejs";
// Each slide rasterises its own PNG through resvg on the request path; a six-slide deck needs
// more than the default budget. Same posture as app/api/export/uuc-phc/data.
export const maxDuration = 60;

/**
 * PPTX export: one slide per requested indicator, each with native editable title/caption/source
 * text boxes and the same PNG chart embedded.
 *
 * Increment 5.5 generalised this from exactly one slide to a deck. `?indicator=` is unchanged and
 * still yields a single slide, so every existing export link keeps working; `?indicators=a,b,c`
 * builds a deck for one geography. The per-slide layout, the "no naked numbers" benchmark block
 * and the source footer moved to `lib/exports/pptx-slide.ts` and are applied to every slide — a
 * deck whose later slides drop their provenance is worse than one slide that keeps it, because a
 * figure gets separated from its source the moment someone copies it into another deck.
 */
export async function GET(request: Request) {
  const parsed = parseExportDeckQuery(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  // Sequential, not Promise.all: each slide rasterises a PNG, and running six resvg renders at
  // once on a small serverless instance is how this route runs out of memory rather than time.
  const figures = [];
  if (parsed.data.kind === "district") {
    const { districtCode, indicators } = parsed.data;
    for (const indicator of indicators) {
      const data = await getDistrictExportFigureData({ districtCode, indicator });
      if (data) figures.push(data);
    }
  } else {
    const { geoCode, geoLevel, indicators, dimension } = parsed.data;
    for (const indicator of indicators) {
      const data = await getExportFigureData({ geoCode, geoLevel, indicator, dimension });
      if (data) figures.push(data);
    }
  }

  // Every requested indicator missing means the place itself is not exportable; some missing is a
  // thinner deck, which is the honest outcome rather than an error.
  if (figures.length === 0) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const pres = new PptxGenJS();
  pres.author = "BHW Connect";
  for (const data of figures) {
    await addFigureSlide(pres, data);
  }

  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  const first = figures[0];

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${
        figures.length === 1
          ? slugify(first.title, first.geoName)
          : slugify(first.geoName, "bhw-connect-deck")
      }.pptx"`,
    },
  });
}
