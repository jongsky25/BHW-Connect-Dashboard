import "server-only";
import type PptxGenJS from "pptxgenjs";
import { formatBenchmarkLine, type ExportFigureData } from "./figure-data";
import { footerLines, renderFigurePng } from "./render-png";

/**
 * One figure as one PPTX slide (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.5).
 *
 * Lifted verbatim out of `app/api/export/pptx/route.ts`, which built exactly one slide inline.
 * Extracting it is what lets a whole area profile or a chat session export as a deck, and it keeps
 * the per-slide contract intact while doing so: the "no naked numbers" block (Increment 5) and the
 * source footer belong to **every** slide, not to the first one. A deck whose later slides drop
 * their provenance is worse than a single slide that keeps it — the figures get separated from
 * their sources the moment someone copies one into another deck.
 */
export async function addFigureSlide(pres: PptxGenJS, data: ExportFigureData): Promise<void> {
  const pngBuffer = await renderFigurePng(data);
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
}
