import "server-only";
import { getGeoByCode } from "@/lib/db/geo";
import { getUucPhcBarangays, getUucPhcChildren, getUucPhcCounts } from "@/lib/db/uuc-phc";
import type { UucPhcChild, UucPhcCounts } from "@/lib/db/uuc-phc";
import type { GeoLevel } from "@/lib/filters/schema";
import { escapeXml, resvgFont } from "./render-png";

/**
 * One-page PNG summary of the 2025 UUC for PHC list for a geo (plan U4).
 *
 * Mirrors `profiling-status-figure.ts` — same canvas, same resvg path, same "no system fonts on
 * the serverless runtime" constraint — but renders a membership list rather than a funnel: one
 * count against one denominator, a single two-state bar, and a child table ordered by share.
 *
 * **No indicator values appear here.** They render on screen only, where a bounded value can
 * carry its † marker and its footnote; a one-pager that reproduced them without that context
 * would be exactly the unmarked artefact U3 was built to avoid. See
 * `lib/db/uuc-phc-indicators.ts`.
 */

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

// A4 portrait-ish canvas (~96dpi width). Height grows with the table.
const WIDTH = 794;
const MARGIN = 32;
const INNER = WIDTH - MARGIN * 2;
const MUTED = "#57616a";
const INK = "#1a1d1e";
const BORDER = "#dde1e3";
const ACCENT = "#0a6e6e";
const TRACK = "#f6f7f8";

/** How many child rows a page can carry before it stops being a one-pager. National has 18
 * regions and a province at most ~40 cities, so this only ever binds on a large province — where
 * the remainder is stated rather than silently dropped. */
const MAX_CHILD_ROWS = 42;
/** Same idea for the barangay names on a city/municipality sheet. */
const MAX_BARANGAY_NAMES = 60;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/**
 * Packs names into comma-joined lines of at most `maxChars`. Exported for unit tests: SVG has no
 * text wrapping, so an unwrapped line runs straight off the page edge with no error.
 */
export function wrapNames(names: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const name of names) {
    const next = line === "" ? name : `${line}, ${name}`;
    if (next.length > maxChars) {
      if (line !== "") lines.push(line);
      line = name;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

export type UucPhcFigure = {
  svg: string;
  filenameParts: [string, string];
};

/**
 * Assembles the one-page summary SVG for a geo. Returns null when the area has no row at all —
 * a read failure, not an area with none listed, which is a real result the sheet renders as 0.
 */
export async function buildUucPhcFigure(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<UucPhcFigure | null> {
  const isCitymun = geoLevel === "citymun";
  const [geo, counts, children, barangays] = await Promise.all([
    getGeoByCode(geoCode),
    getUucPhcCounts(geoCode, geoLevel),
    getUucPhcChildren(geoCode, geoLevel),
    isCitymun ? getUucPhcBarangays(geoCode) : Promise.resolve([]),
  ]);
  if (!counts) return null;

  const geoName = geo?.geoName ?? geoCode;
  const generated = new Date().toISOString().slice(0, 10);
  const childHeading = CHILD_HEADING[geoLevel];

  let y = MARGIN;
  const parts: string[] = [];

  // ---- Header + meta ----
  parts.push(
    `<text x="${MARGIN}" y="${y + 24}" font-size="22" font-weight="600" fill="${INK}">UUC for PHC 2025</text>`,
  );
  y += 40;
  parts.push(
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" fill="${MUTED}">${escapeXml(`${LEVEL_LABEL[geoLevel]}: ${geoName}`)}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + INNER}" y="${y + 14}" font-size="12" fill="${MUTED}" text-anchor="end">Generated ${generated}</text>`,
  );
  y += 28;

  // ---- Headline: the count, its denominator, its share ----
  parts.push(
    `<text x="${MARGIN}" y="${y + 26}" font-size="34" font-weight="600" fill="${INK}">${fmt(counts.nListed)}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + 12 + String(fmt(counts.nListed)).length * 20}" y="${y + 26}" font-size="14" fill="${MUTED}">${escapeXml(
      `of ${fmt(counts.nBarangays)} barangays${counts.sharePct === null ? "" : ` · ${counts.sharePct}%`}`,
    )}</text>`,
  );
  y += 40;
  parts.push(
    `<text x="${MARGIN}" y="${y + 12}" font-size="12" fill="${MUTED}">unserved and underserved barangays for primary health care</text>`,
  );
  y += 26;

  // ---- The share bar: two states, because membership is binary ----
  const fillW = Math.round(INNER * counts.fraction);
  parts.push(`<rect x="${MARGIN}" y="${y}" width="${INNER}" height="12" rx="6" fill="${TRACK}"/>`);
  if (fillW > 0) {
    parts.push(
      `<rect x="${MARGIN}" y="${y}" width="${fillW}" height="12" rx="6" fill="${ACCENT}"/>`,
    );
  }
  y += 24;
  // Two anchored elements, not one string with padding spaces: SVG collapses runs of whitespace,
  // so a padded single line renders as "…14% Not on the list…" with nothing separating the halves.
  parts.push(
    `<text x="${MARGIN}" y="${y + 8}" font-size="11" fill="${MUTED}">${escapeXml(
      `On the list ${fmt(counts.nListed)} · ${pct(counts.sharePct)}`,
    )}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + INNER}" y="${y + 8}" font-size="11" fill="${MUTED}" text-anchor="end">${escapeXml(
      `Not on the list ${fmt(Math.max(0, counts.nBarangays - counts.nListed))} · ${
        counts.sharePct === null ? "—" : `${100 - counts.sharePct}%`
      }`,
    )}</text>`,
  );
  y += 24;

  if (counts.nListed === 0) {
    // A real zero: this list is a single national publication, so nothing listed means assessed
    // and not qualifying — not an area the data has yet to reach.
    parts.push(
      `<text x="${MARGIN}" y="${y + 10}" font-size="12" fill="${INK}">${escapeXml(
        `No barangay in ${geoName} is on the 2025 list. The list is national and complete as published.`,
      )}</text>`,
    );
    y += 22;
  }

  parts.push(
    `<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`,
  );
  y += 18;

  // ---- Child breakdown, ordered by share (most affected first) ----
  if (childHeading && children.length > 0) {
    const sorted: UucPhcChild[] = [...children].sort(
      (a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1) || b.nListed - a.nListed,
    );
    const shown = sorted.slice(0, MAX_CHILD_ROWS);

    parts.push(
      `<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(childHeading)}</text>`,
    );
    const cListed = MARGIN + INNER - 260;
    const cAll = MARGIN + INNER - 120;
    const cShare = MARGIN + INNER;
    parts.push(
      `<text x="${cListed}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">On the list</text>`,
    );
    parts.push(
      `<text x="${cAll}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">All barangays</text>`,
    );
    parts.push(
      `<text x="${cShare}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Share</text>`,
    );
    y += 6;
    parts.push(
      `<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`,
    );
    y += 16;
    for (const c of shown) {
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(c.geoName)}</text>`,
      );
      parts.push(
        `<text x="${cListed}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${fmt(c.nListed)}</text>`,
      );
      parts.push(
        `<text x="${cAll}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(c.nBarangays)}</text>`,
      );
      parts.push(
        `<text x="${cShare}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${pct(c.sharePct)}</text>`,
      );
      y += 18;
    }
    if (sorted.length > shown.length) {
      // Say what was left out rather than letting the sheet imply it is the whole list.
      const rest = sorted.length - shown.length;
      const restListed = sorted.slice(shown.length).reduce((sum, c) => sum + c.nListed, 0);
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
          `+ ${rest} more with a lower share, ${fmt(restListed)} listed barangays between them.`,
        )}</text>`,
      );
      y += 18;
    }
    y += 4;
  }

  // ---- City/municipality sheets name the listed barangays themselves ----
  if (isCitymun) {
    const listed = barangays.filter((b) => b.listed).map((b) => b.geoName);
    if (listed.length > 0) {
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">Barangays on the list</text>`,
      );
      y += 16;
      const shown = listed.slice(0, MAX_BARANGAY_NAMES);
      for (const line of wrapNames(shown, 95)) {
        parts.push(
          `<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(line)}</text>`,
        );
        y += 15;
      }
      if (listed.length > shown.length) {
        parts.push(
          `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
            `+ ${listed.length - shown.length} more.`,
          )}</text>`,
        );
        y += 15;
      }
      y += 6;
    }
  }

  // ---- Footer ----
  y += 10;
  parts.push(
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Source: DOH Bureau of Local Health Systems Development — 2025 list of Unserved and Underserved Communities for PHC (DC No. 2025-0549).</text>`,
  );
  y += 14;
  parts.push(
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Criteria per DOH AO No. 2020-0023: a barangay qualifies only when both a physical and a socio-economic factor are present.</text>`,
  );
  y += 14;
  parts.push(
    `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">Denominator is every barangay in the area. National total 5,987, which is also what the 2027 Budget Cue Cards give for this list.</text>`,
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

  return { svg, filenameParts: [geoName, "uuc-phc-2025"] };
}

/** Rasterizes the one-pager SVG to a PNG buffer with the bundled export fonts. */
export async function renderUucPhcPng(figure: UucPhcFigure): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  return new Resvg(figure.svg, {
    fitTo: { mode: "width", value: WIDTH * 2 },
    font: resvgFont(),
  })
    .render()
    .asPng();
}

export type { UucPhcCounts };
