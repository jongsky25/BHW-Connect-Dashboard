import "server-only";
import { getGeoByCode } from "@/lib/db/geo";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";
import type { ProfilingStatus, ProfilingStage } from "@/lib/db/profiling-status";
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
  citymun: "Barangays",
};

const STAGES = [
  { key: "encoded", label: "Encoded", color: "#7fc0be" },
  { key: "validated", label: "Validated", color: "#237f7c" },
  { key: "attested", label: "Attested", color: "#0a6e6e" },
  { key: "notEncoded", label: "Not yet encoded", color: "#c9ced2" },
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
function pct(stage: ProfilingStage): string {
  return stage.pct === null ? "—" : `${stage.pct}%`;
}
/** A raw percentage value rendered as "N%" or an em-dash when unknown. */
function pct2(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/** One stage bar (label · count · %), width = the stage's share of the stacked bar. */
function summaryBar(y: number, label: string, color: string, stage: ProfilingStage): string {
  const barY = y + 14;
  const barW = INNER;
  const fillW = Math.round(barW * stage.fraction);
  return `
    <text x="${MARGIN}" y="${y + 10}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(label)}</text>
    <text x="${MARGIN + INNER}" y="${y + 10}" font-size="13" fill="${MUTED}" text-anchor="end">${fmt(stage.count)} · ${pct(stage)}</text>
    <rect x="${MARGIN}" y="${barY}" width="${barW}" height="10" rx="5" fill="#f6f7f8"/>
    <rect x="${MARGIN}" y="${barY}" width="${fillW}" height="10" rx="5" fill="${color}"/>`;
}

/** A right-aligned "n · p%" cell. */
function cell(x: number, y: number, count: number, stage: ProfilingStage): string {
  return `<text x="${x}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${fmt(count)} · ${pct(stage)}</text>`;
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
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" fill="${INK}">${escapeXml(`${fmt(status.totalBhw)} BHWs to profile — Encoded ${fmt(status.encoded.count)} (${pct(status.encoded)}) · Validated ${fmt(status.validated.count)} (${pct(status.validated)}) · Attested ${fmt(status.attested.count)} (${pct(status.attested)}) · Not encoded ${fmt(status.notEncoded.count)} (${pct(status.notEncoded)})`)}</text>`,
  );
  y += 20;
  // The "how far to go" line — the attestation gap, the headline the page leads with.
  parts.push(
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(`${fmt(status.toAttest.count)} still to attest${status.toAttest.pct === null ? "" : ` (${status.toAttest.pct}% to go)`}`)}</text>`,
  );
  y += 26;
  parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
  y += 14;

  // Stage bars — the four mutually-exclusive stages, which sum to 100% of the denominator.
  parts.push(`<text x="${MARGIN}" y="${y + 8}" font-size="12" font-weight="600" fill="${MUTED}">Stages (% of all BHWs to profile — add up to 100%)</text>`);
  y += 20;
  for (const s of STAGES) {
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
    const cTotal = MARGIN + INNER - 440;
    const cEnc = MARGIN + INNER - 330;
    const cVal = MARGIN + INNER - 220;
    const cAtt = MARGIN + INNER - 110;
    const cNot = MARGIN + INNER;
    parts.push(`<text x="${cTotal}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Total</text>`);
    parts.push(`<text x="${cEnc}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Encoded</text>`);
    parts.push(`<text x="${cVal}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Validated</text>`);
    parts.push(`<text x="${cAtt}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Attested</text>`);
    parts.push(`<text x="${cNot}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Not encoded</text>`);
    y += 6;
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
    y += 16;
    for (const c of children) {
      parts.push(`<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(c.geoName)}</text>`);
      parts.push(`<text x="${cTotal}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(c.totalBhw)}</text>`);
      parts.push(cell(cEnc, y, c.encoded.count, c.encoded));
      parts.push(cell(cVal, y, c.validated.count, c.validated));
      parts.push(cell(cAtt, y, c.attested.count, c.attested));
      parts.push(
        `<text x="${cNot}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(c.notEncoded.count)} · ${pct2(c.notEncoded.pct)}</text>`,
      );
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
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Four mutually-exclusive stages that sum to 100%: Encoded (awaiting validation) · Validated · Attested · Not yet encoded.</text>`,
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
