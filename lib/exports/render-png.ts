import "server-only";
import path from "node:path";
import { renderBarChartSvg } from "@/lib/charts/render-svg";
import { formatBenchmarkLine, type ExportFigureData } from "./figure-data";

/**
 * Bundled fonts for server-side rasterization. Vercel's serverless runtime
 * ships no system fonts, so `new Resvg(...)` with the default (system-font)
 * config silently drops every text node — titles, axis labels, headline and
 * footer all vanished from PNG/PPTX exports in production. DejaVu Sans is
 * bundled here (and force-included into the export functions via
 * `outputFileTracingIncludes` in next.config.ts, keyed off `process.cwd()` the
 * same way the place page loads public/geo) and passed to resvg explicitly; it
 * covers the peso sign ₱ (U+20B1) the honorarium figures use.
 *
 * The SVGs request `font-family="system-ui, sans-serif"` (matching the
 * on-screen figure); that family isn't loaded, so resvg falls back to
 * `defaultFontFamily` — "DejaVu Sans" — for every text node. The `600`-weight
 * title/axis labels pick up the bundled bold face.
 */
const FONT_DIR = path.join(process.cwd(), "lib", "exports", "fonts");
const DEFAULT_FONT_FAMILY = "DejaVu Sans";

/** Font config shared by every `new Resvg(...)` call — also reused by the profiling-status
 * one-pager (lib/exports/profiling-status-figure.ts) so both rasterize with the same
 * bundled fonts. */
export function resvgFont() {
  return {
    fontFiles: [path.join(FONT_DIR, "DejaVuSans.ttf"), path.join(FONT_DIR, "DejaVuSans-Bold.ttf")],
    loadSystemFonts: false,
    defaultFontFamily: DEFAULT_FONT_FAMILY,
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractSvgInner(svg: string): { viewBox: string; inner: string } {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return { viewBox: viewBoxMatch?.[1] ?? "0 0 640 200", inner };
}

const MARGIN = 24;
const HEADER_H = 68;
const HEADLINE_H = 36;
const FOOTER_LINE_H = 16;
const FOOTER_H = FOOTER_LINE_H * 2 + 8;
/** Line height for the benchmark/peer/adequacy block (Increment 5) — same
 * footer-style size as `footerSvg`, so the extra lines read as a natural
 * continuation of the figure rather than a second, differently-styled block. */
const EXTRA_LINE_H = 16;

/** Two lines rather than one — the full source name + license + date reliably overflows a single line at export width. */
export function footerLines(data: ExportFigureData): [string, string] {
  const retrieved = new Date().toISOString().slice(0, 10);
  return [`Source: ${data.sourceName}`, `Licensed ${data.license} · Retrieved ${retrieved}`];
}

function footerSvg(x: number, firstLineY: number): string {
  return `<text x="${x}" y="${firstLineY}" font-size="10" font-family="system-ui, sans-serif" fill="#57616a">{{LINE1}}</text>
    <text x="${x}" y="${firstLineY + FOOTER_LINE_H}" font-size="10" font-family="system-ui, sans-serif" fill="#57616a">{{LINE2}}</text>`;
}

function withFooterText(template: string, data: ExportFigureData): string {
  const [line1, line2] = footerLines(data);
  return template.replace("{{LINE1}}", escapeXml(line1)).replace("{{LINE2}}", escapeXml(line2));
}

/**
 * Up to 3 "no naked numbers" lines (Increment 5): the joined vertical
 * benchmark ("This place 62% · Region VII 71% · Philippines 68%"), the
 * compact peer-standing sentence, and the adequacy note — same wording the
 * on-screen `FigureBenchmark` slot renders, so an export reads like the page.
 * Any of the three may be absent; only present lines take up height.
 */
function benchmarkLines(data: ExportFigureData): string[] {
  const lines: string[] = [];
  if (data.benchmark && data.benchmark.rows.some((r) => r.value !== null)) {
    lines.push(formatBenchmarkLine(data.benchmark));
  }
  if (data.benchmark?.peerLine) {
    lines.push(data.benchmark.peerLine);
  }
  if (data.adequacyNote) {
    lines.push(data.adequacyNote);
  }
  return lines;
}

function benchmarkSvg(x: number, firstLineY: number, lines: string[]): string {
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${firstLineY + i * EXTRA_LINE_H}" font-size="11" font-family="system-ui, sans-serif" fill="#57616a">${escapeXml(line)}</text>`,
    )
    .join("\n    ");
}

/** Composes a title + caption + chart + headline + footer into one PNG, matching the on-screen FigureCard. */
export async function renderFigurePng(data: ExportFigureData): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");

  const lines = benchmarkLines(data);
  const extraH = lines.length > 0 ? lines.length * EXTRA_LINE_H + 10 : 0;

  if (data.isSuppressed || data.rows.length === 0) {
    const width = 640;
    const height = 236 + extraH;
    const message = data.isSuppressed ? "Suppressed to protect privacy (n<5)" : "No data available";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="${MARGIN}" y="32" font-size="20" font-weight="600" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.title)}</text>
      <text x="${MARGIN}" y="52" font-size="12" font-family="system-ui, sans-serif" fill="#57616a">${escapeXml(data.caption)}</text>
      <rect x="${MARGIN}" y="72" width="${width - MARGIN * 2}" height="80" fill="#f6f7f8"/>
      <text x="${width / 2}" y="118" font-size="14" font-family="system-ui, sans-serif" fill="#57616a" text-anchor="middle">${escapeXml(message)}</text>
      ${benchmarkSvg(MARGIN, 172, lines)}
      ${footerSvg(MARGIN, height - FOOTER_H + FOOTER_LINE_H)}
    </svg>`;
    return new Resvg(withFooterText(svg, data), {
      fitTo: { mode: "width", value: width * 2 },
      font: resvgFont(),
    })
      .render()
      .asPng();
  }

  const chart = await renderBarChartSvg(
    data.rows.map((r) => ({ label: r.label, value: r.value })),
    { xLabel: data.xLabel, yLabel: data.yLabel, valueSuffix: data.valueSuffix },
  );
  const { viewBox, inner } = extractSvgInner(chart.svg);

  const width = chart.width + MARGIN * 2;
  const height = HEADER_H + chart.height + HEADLINE_H + extraH + FOOTER_H;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${MARGIN}" y="26" font-size="20" font-weight="600" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.title)}</text>
    <text x="${MARGIN}" y="46" font-size="12" font-family="system-ui, sans-serif" fill="#57616a">${escapeXml(data.caption)}</text>
    <svg x="${MARGIN}" y="${HEADER_H}" width="${chart.width}" height="${chart.height}" viewBox="${viewBox}" color="#1a1d1e">${inner}</svg>
    <text x="${MARGIN}" y="${HEADER_H + chart.height + 24}" font-size="13" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.headline)}</text>
    ${benchmarkSvg(MARGIN, HEADER_H + chart.height + 44, lines)}
    ${footerSvg(MARGIN, height - FOOTER_H + FOOTER_LINE_H)}
  </svg>`;

  return new Resvg(withFooterText(svg, data), {
    fitTo: { mode: "width", value: width * 2 },
    font: resvgFont(),
  })
    .render()
    .asPng();
}
