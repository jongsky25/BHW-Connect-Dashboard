import "server-only";
import { getGeoByCode } from "@/lib/db/geo";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";
import type { ProfilingStatus, ProfilingStatusStep } from "@/lib/db/profiling-status";
import type { GeoLevel } from "@/lib/filters/schema";
import { escapeXml, resvgFont } from "./render-png";

const LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "National",
  region: "Region",
  province: "Province",
  citymun: "City / Municipality",
  barangay: "Barangay",
};

const CHILD_HEADING: Partial<Record<GeoLevel, string>> = {
  national: "Regions",
  region: "Provinces",
  province: "Cities / municipalities",
};

const STEPS = [
  { key: "encode", label: "Encode", color: "#7fc0be" },
  { key: "validate", label: "Validate", color: "#237f7c" },
  { key: "certify", label: "Certify", color: "#0a6e6e" },
] as const;

// A4 portrait-ish canvas (~96dpi width). Height grows with the child table.
const WIDTH = 794;
const MARGIN = 32;
const INNER = WIDTH - MARGIN * 2;
const MUTED = "#57616a";
const INK = "#1a1d1e";
const BORDER = "#dde1e3";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function pct(step: ProfilingStatusStep): string {
  return step.pct === null ? "—" : `${step.pct}%`;
}

/** One summary bar (label · count · %), width = capped % of the denominator. */
function summaryBar(y: number, label: string, color: string, step: ProfilingStatusStep): string {
  const barY = y + 14;
  const barW = INNER;
  const fillW = Math.round((barW * (step.pctCapped ?? 0)) / 100);
  return `
    <text x="${MARGIN}" y="${y + 10}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(label)}</text>
    <text x="${MARGIN + INNER}" y="${y + 10}" font-size="13" fill="${MUTED}" text-anchor="end">${fmt(step.count)} · ${pct(step)}</text>
    <rect x="${MARGIN}" y="${barY}" width="${barW}" height="10" rx="5" fill="#f6f7f8"/>
    <rect x="${MARGIN}" y="${barY}" width="${fillW}" height="10" rx="5" fill="${color}"/>`;
}

/** A right-aligned "n · p%" cell. */
function cell(x: number, y: number, count: number, step: ProfilingStatusStep): string {
  return `<text x="${x}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${fmt(count)} · ${pct(step)}</text>`;
}

export type ProfilingStatusFigure = {
  svg: string;
  filenameParts: [string, string];
};

/** Assembles the one-page profiling-status summary SVG for a geo (header + meta, funnel
 * summary, child-unit breakdown, and bar chart). Returns null if the geo has no data. */
export async function buildProfilingStatusFigure(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<ProfilingStatusFigure | null> {
  const [geo, status, children] = await Promise.all([
    getGeoByCode(geoCode),
    getProfilingStatus(geoCode, geoLevel),
    getProfilingStatusChildren(geoCode, geoLevel),
  ]);
  if (!status) return null;

  const geoName = geo?.geoName ?? geoCode;
  const generated = new Date().toISOString().slice(0, 10);
  const childHeading = CHILD_HEADING[geoLevel];

  // ---- vertical layout ----
  let y = MARGIN;
  const parts: string[] = [];

  // Header + meta
  parts.push(
    `<text x="${MARGIN}" y="${y + 24}" font-size="22" font-weight="600" fill="${INK}">BHW Profiling Status 2026</text>`,
  );
  y += 40;
  parts.push(
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" fill="${MUTED}">${escapeXml(`${LEVEL_LABEL[geoLevel]}: ${geoName}`)}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + INNER}" y="${y + 14}" font-size="12" fill="${MUTED}" text-anchor="end">Generated ${generated}</text>`,
  );
  y += 24;
  parts.push(
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" fill="${INK}">${escapeXml(`${fmt(status.totalBhw)} BHWs to profile — Encoded ${fmt(status.encode.count)} (${pct(status.encode)}) · Validated ${fmt(status.validate.count)} (${pct(status.validate)}) · Certified ${fmt(status.certify.count)} (${pct(status.certify)})`)}</text>`,
  );
  y += 26;
  parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
  y += 14;

  // Funnel summary bars
  parts.push(`<text x="${MARGIN}" y="${y + 8}" font-size="12" font-weight="600" fill="${MUTED}">Pipeline (% of all BHWs to profile)</text>`);
  y += 20;
  for (const s of STEPS) {
    parts.push(summaryBar(y, s.label, s.color, status[s.key]));
    y += 40;
  }
  y += 4;

  // Child-unit breakdown table
  if (childHeading && children.length > 0) {
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
    y += 20;
    parts.push(`<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(childHeading)}</text>`);
    // column x positions (right-aligned numeric columns)
    const cTotal = MARGIN + INNER - 360;
    const cEnc = MARGIN + INNER - 240;
    const cVal = MARGIN + INNER - 110;
    const cCert = MARGIN + INNER;
    parts.push(`<text x="${cTotal}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Total</text>`);
    parts.push(`<text x="${cEnc}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Encoded</text>`);
    parts.push(`<text x="${cVal}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Validated</text>`);
    parts.push(`<text x="${cCert}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Certified</text>`);
    y += 6;
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
    y += 16;
    for (const c of children) {
      parts.push(`<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(c.geoName)}</text>`);
      parts.push(`<text x="${cTotal}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(c.totalBhw)}</text>`);
      parts.push(cell(cEnc, y, c.encode.count, c.encode));
      parts.push(cell(cVal, y, c.validate.count, c.validate));
      parts.push(cell(cCert, y, c.certify.count, c.certify));
      y += 18;
    }
    y += 2;
  }

  // Footer — two lines so the definitions don't overflow the page width.
  y += 12;
  parts.push(
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Source: DOH BHW Connect — 2026 individual-profiling encoding status.</text>`,
  );
  y += 14;
  parts.push(
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Encode = all pipeline records · Validate = validated + approved · Certify = approved.</text>`,
  );
  y += 20;

  const height = y + MARGIN;
  // No system fonts on the serverless runtime; every text node inherits the family here so
  // resvg falls back to the bundled DejaVu Sans (see lib/exports/render-png.ts).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g font-family="system-ui, sans-serif">
    ${parts.join("\n    ")}
    </g>
  </svg>`;

  return { svg, filenameParts: [geoName, "profiling-status-2026"] };
}

/** Rasterizes the one-pager SVG to a PNG buffer with the bundled export fonts. */
export async function renderProfilingStatusPng(figure: ProfilingStatusFigure): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  return new Resvg(figure.svg, {
    fitTo: { mode: "width", value: WIDTH * 2 },
    font: resvgFont(),
  })
    .render()
    .asPng();
}

// Re-export for callers that only need the funnel type without importing the db module.
export type { ProfilingStatus };
