import "server-only";
import { renderBarChartSvg } from "@/lib/charts/render-svg";
import type { ExportFigureData } from "./figure-data";

function escapeXml(value: string): string {
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

/** Composes a title + caption + chart + headline + footer into one PNG, matching the on-screen FigureCard. */
export async function renderFigurePng(data: ExportFigureData): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");

  if (data.isSuppressed || data.rows.length === 0) {
    const width = 640;
    const height = 236;
    const message = data.isSuppressed
      ? "Suppressed to protect privacy (n<5)"
      : "No data available";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="${MARGIN}" y="32" font-size="20" font-weight="600" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.title)}</text>
      <text x="${MARGIN}" y="52" font-size="12" font-family="system-ui, sans-serif" fill="#57616a">${escapeXml(data.caption)}</text>
      <rect x="${MARGIN}" y="72" width="${width - MARGIN * 2}" height="80" fill="#f6f7f8"/>
      <text x="${width / 2}" y="118" font-size="14" font-family="system-ui, sans-serif" fill="#57616a" text-anchor="middle">${escapeXml(message)}</text>
      ${footerSvg(MARGIN, height - FOOTER_H + FOOTER_LINE_H)}
    </svg>`;
    return new Resvg(withFooterText(svg, data), { fitTo: { mode: "width", value: width * 2 } })
      .render()
      .asPng();
  }

  const chart = await renderBarChartSvg(
    data.rows.map((r) => ({ label: r.label, value: r.value })),
    { xLabel: data.xLabel, yLabel: data.yLabel, valueSuffix: data.valueSuffix },
  );
  const { viewBox, inner } = extractSvgInner(chart.svg);

  const width = chart.width + MARGIN * 2;
  const height = HEADER_H + chart.height + HEADLINE_H + FOOTER_H;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${MARGIN}" y="26" font-size="20" font-weight="600" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.title)}</text>
    <text x="${MARGIN}" y="46" font-size="12" font-family="system-ui, sans-serif" fill="#57616a">${escapeXml(data.caption)}</text>
    <svg x="${MARGIN}" y="${HEADER_H}" width="${chart.width}" height="${chart.height}" viewBox="${viewBox}">${inner}</svg>
    <text x="${MARGIN}" y="${HEADER_H + chart.height + 24}" font-size="13" font-family="system-ui, sans-serif" fill="#1a1d1e">${escapeXml(data.headline)}</text>
    ${footerSvg(MARGIN, height - FOOTER_H + FOOTER_LINE_H)}
  </svg>`;

  return new Resvg(withFooterText(svg, data), { fitTo: { mode: "width", value: width * 2 } })
    .render()
    .asPng();
}
