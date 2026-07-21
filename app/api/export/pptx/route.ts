import PptxGenJS from "pptxgenjs";
import { NextResponse } from "next/server";
import { formatBenchmarkLine, getExportFigureData } from "@/lib/exports/figure-data";
import { parseExportQuery, slugify } from "@/lib/exports/query";
import { renderFigurePng, footerLines } from "@/lib/exports/render-png";

export const runtime = "nodejs";

/** PPTX export: one slide, native editable title/caption/source text boxes + the same PNG chart embedded. */
export async function GET(request: Request) {
  const parsed = parseExportQuery(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  const data = await getExportFigureData(parsed.data);
  if (!data) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const pngBuffer = await renderFigurePng(data);

  const pres = new PptxGenJS();
  pres.author = "BHW Connect";
  const slide = pres.addSlide();

  slide.addText(`${data.title} — ${data.geoName}`, {
    x: 0.4,
    y: 0.3,
    w: 9.2,
    fontSize: 22,
    bold: true,
    color: "1A1D1E",
  });
  slide.addText(data.caption, { x: 0.4, y: 0.85, w: 9.2, fontSize: 11, color: "57616A" });
  slide.addImage({
    data: `image/png;base64,${pngBuffer.toString("base64")}`,
    x: 0.4,
    y: 1.3,
    w: 9.2,
    h: 4.2,
    sizing: { type: "contain", w: 9.2, h: 4.2 },
  });
  slide.addText(data.headline, { x: 0.4, y: 5.7, w: 9.2, fontSize: 13, color: "1A1D1E" });

  // "No naked numbers" block (Increment 5): the same joined benchmark line,
  // peer-rank sentence, and adequacy note the on-screen FigureBenchmark slot
  // renders — one text box between the headline and the source footer.
  const benchmarkParagraphs = [
    data.benchmark && data.benchmark.rows.some((r) => r.value !== null)
      ? formatBenchmarkLine(data.benchmark)
      : null,
    data.benchmark?.peerLine ?? null,
    data.adequacyNote || null,
  ].filter((s): s is string => Boolean(s));
  if (benchmarkParagraphs.length > 0) {
    slide.addText(benchmarkParagraphs.join("\n"), {
      x: 0.4,
      y: 6.05,
      w: 9.2,
      h: 0.8,
      fontSize: 10,
      color: "57616A",
    });
  }

  slide.addText(footerLines(data).join("  ·  "), {
    x: 0.4,
    y: 6.9,
    w: 9.2,
    fontSize: 8,
    color: "57616A",
  });

  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${slugify(data.title, data.geoName)}.pptx"`,
    },
  });
}
