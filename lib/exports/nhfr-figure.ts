import "server-only";
import { getGeoByCode } from "@/lib/db/geo";
import {
  getNhfrChildren,
  getNhfrCounts,
  getNhfrFacilities,
  getNhfrTypes,
  NHFR_SNAPSHOT_LABEL,
} from "@/lib/db/nhfr";
import type { NhfrChild, NhfrCounts, NhfrFacility, NhfrTypeCount } from "@/lib/db/nhfr";
import type { GeoLevel } from "@/lib/filters/schema";
import { escapeXml, resvgFont } from "./render-png";

/**
 * One-page PNG summary of the NHFR health-facility registry for a geo — the last item of
 * `docs/NHFR_2026_PLAN.md`'s Deferred list.
 *
 * Mirrors `uuc-phc-figure.ts` / `profiling-status-figure.ts` — same canvas, same resvg path, same
 * "no system fonts on the serverless runtime" constraint — but its two bars are the two
 * exhaustive binary splits this dataset actually supports: barangay coverage and ownership. See
 * `lib/db/nhfr.ts` for why there is no third bar for licensing.
 *
 * **No licensing figure appears here**, for the same reason `FacilityList` and `FacilityStats`
 * carry none: 63% of the register has no licensing status in the source, overwhelmingly barangay
 * health stations, and neither aggregate table (`agg_nhfr_counts`, `agg_nhfr_by_type`) carries a
 * licensing column to derive one from. The footer says so, rather than the sheet implying nothing
 * was missed.
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

// A4 portrait-ish canvas (~96dpi width). Height grows with the tables.
const WIDTH = 794;
const MARGIN = 32;
const INNER = WIDTH - MARGIN * 2;
const MUTED = "#57616a";
const INK = "#1a1d1e";
const BORDER = "#dde1e3";
const ACCENT = "#0a6e6e";
const TRACK = "#f6f7f8";

/** Same reasoning as uuc-phc's MAX_CHILD_ROWS: binds only on a large province (Cebu has 50
 * cities), where the remainder is stated rather than silently dropped. */
const MAX_CHILD_ROWS = 42;
/** 45 facility types exist nationally; a typical area has far fewer. */
const MAX_TYPE_ROWS = 20;
/** Named individually on a city/municipality sheet — see the selection rule below. */
const MAX_FACILITY_NAMES = 40;

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

/** One filled-track bar with a heading above it and a two-anchored legend below it. Mutates
 * `parts` and returns the advanced `y`, mirroring the rest of this file's cursor style. */
function pushTwoStateBar(
  parts: string[],
  y: number,
  heading: string,
  left: { label: string; count: number; pct: number | null },
  right: { label: string; count: number; pct: number | null },
  fraction: number,
): number {
  parts.push(
    `<text x="${MARGIN}" y="${y + 10}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(heading)}</text>`,
  );
  y += 20;
  const fillW = Math.round(INNER * fraction);
  parts.push(`<rect x="${MARGIN}" y="${y}" width="${INNER}" height="12" rx="6" fill="${TRACK}"/>`);
  if (fillW > 0) {
    parts.push(`<rect x="${MARGIN}" y="${y}" width="${fillW}" height="12" rx="6" fill="${ACCENT}"/>`);
  }
  y += 24;
  // Two anchored elements, not one padded string: SVG collapses runs of whitespace, so a padded
  // single line loses the gap between the halves (the bug U4 caught by rendering and looking).
  parts.push(
    `<text x="${MARGIN}" y="${y + 8}" font-size="11" fill="${MUTED}">${escapeXml(
      `${left.label} ${fmt(left.count)} · ${pct(left.pct)}`,
    )}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + INNER}" y="${y + 8}" font-size="11" fill="${MUTED}" text-anchor="end">${escapeXml(
      `${right.label} ${fmt(right.count)} · ${pct(right.pct)}`,
    )}</text>`,
  );
  y += 24;
  return y;
}

export type NhfrFigureInput = {
  geoName: string;
  geoLevel: GeoLevel;
  /** ISO date, passed in rather than read from the clock so the SVG is a pure function of its
   * inputs and can be unit-tested (uuc-phc export's `retrievedAt` precedent). */
  generated: string;
  counts: NhfrCounts;
  children: NhfrChild[];
  types: NhfrTypeCount[];
  /** Only populated for a city/municipality (buildNhfrFigure's precedent). */
  facilities: NhfrFacility[];
};

export type NhfrFigure = {
  svg: string;
  filenameParts: [string, string];
};

/** Assembles the one-page summary SVG from already-fetched data. Pure — no DB access — so it can
 * be unit-tested without mocking Supabase. */
export function composeNhfrFigureSvg(input: NhfrFigureInput): NhfrFigure {
  const { geoName, geoLevel, generated, counts, children, types, facilities } = input;
  const isCitymun = geoLevel === "citymun";
  const childHeading = CHILD_HEADING[geoLevel];

  let y = MARGIN;
  const parts: string[] = [];

  // ---- Header + meta ----
  parts.push(
    `<text x="${MARGIN}" y="${y + 24}" font-size="22" font-weight="600" fill="${INK}">Health facilities</text>`,
  );
  y += 40;
  parts.push(
    `<text x="${MARGIN}" y="${y + 14}" font-size="13" fill="${MUTED}">${escapeXml(`${LEVEL_LABEL[geoLevel]}: ${geoName}`)}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + INNER}" y="${y + 14}" font-size="12" fill="${MUTED}" text-anchor="end">Generated ${generated}</text>`,
  );
  y += 28;

  // ---- Headline: the facility count, this area's own N ----
  parts.push(
    `<text x="${MARGIN}" y="${y + 26}" font-size="34" font-weight="600" fill="${INK}">${fmt(counts.nFacilities)}</text>`,
  );
  parts.push(
    `<text x="${MARGIN + 12 + String(fmt(counts.nFacilities)).length * 20}" y="${y + 26}" font-size="14" fill="${MUTED}">${escapeXml(
      `health ${counts.nFacilities === 1 ? "facility" : "facilities"} · ${NHFR_SNAPSHOT_LABEL}`,
    )}</text>`,
  );
  y += 40;
  parts.push(
    `<text x="${MARGIN}" y="${y + 12}" font-size="12" fill="${MUTED}">hospitals, rural health units, barangay health stations, clinics and laboratories</text>`,
  );
  y += 26;

  // ---- Coverage: the one share this inventory supports, and the finding it leads with ----
  if (counts.nBarangays > 0) {
    y = pushTwoStateBar(
      parts,
      y,
      "Barangays with at least one facility",
      { label: "With a facility", count: counts.nBarangaysWithFacility, pct: counts.coveragePct },
      {
        label: "With none",
        count: Math.max(0, counts.nBarangays - counts.nBarangaysWithFacility),
        pct: counts.coveragePct === null ? null : 100 - counts.coveragePct,
      },
      counts.coverageFraction,
    );
  } else {
    parts.push(
      `<text x="${MARGIN}" y="${y + 10}" font-size="12" fill="${MUTED}">No barangays recorded for this area.</text>`,
    );
    y += 22;
  }

  if (counts.nFacilities === 0) {
    // A real zero: every geo has a row in agg_nhfr_counts, so nothing here is a result, not a gap.
    parts.push(
      `<text x="${MARGIN}" y="${y + 10}" font-size="12" fill="${INK}">${escapeXml(
        `No health facility in ${geoName} is on the DOH registry for this snapshot. Every area has a row, so this is a result rather than missing data.`,
      )}</text>`,
    );
    y += 22;
  } else {
    // ---- Ownership: exhaustive and binary, the second share this dataset actually supports ----
    const govPct = Math.round((100 * counts.nGovernment) / counts.nFacilities);
    y = pushTwoStateBar(
      parts,
      y,
      "Ownership",
      { label: "Government", count: counts.nGovernment, pct: govPct },
      { label: "Private", count: counts.nPrivate, pct: 100 - govPct },
      counts.nGovernment / counts.nFacilities,
    );
  }

  parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
  y += 18;

  // ---- Facility types, most common first (agg_nhfr_by_type is already ordered this way) ----
  if (types.length > 0) {
    const shown = types.slice(0, MAX_TYPE_ROWS);
    parts.push(
      `<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">Facility types</text>`,
    );
    const cFac = MARGIN + INNER - 220;
    const cGov = MARGIN + INNER - 110;
    const cPriv = MARGIN + INNER;
    parts.push(
      `<text x="${cFac}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Facilities</text>`,
    );
    parts.push(
      `<text x="${cGov}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Government</text>`,
    );
    parts.push(
      `<text x="${cPriv}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Private</text>`,
    );
    y += 6;
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
    y += 16;
    for (const t of shown) {
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(t.facilityType)}</text>`,
      );
      parts.push(
        `<text x="${cFac}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${fmt(t.nFacilities)}</text>`,
      );
      parts.push(
        `<text x="${cGov}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(t.nGovernment)}</text>`,
      );
      parts.push(
        `<text x="${cPriv}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(t.nPrivate)}</text>`,
      );
      y += 18;
    }
    if (types.length > shown.length) {
      const rest = types.length - shown.length;
      const restFacilities = types.slice(shown.length).reduce((sum, t) => sum + t.nFacilities, 0);
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
          `+ ${rest} more types, ${fmt(restFacilities)} facilities between them.`,
        )}</text>`,
      );
      y += 18;
    }
    y += 4;
  }

  // ---- Child breakdown, least-covered first — the same order ChildBreakdown renders on screen ----
  if (childHeading && children.length > 0) {
    const sorted: NhfrChild[] = [...children].sort((a, b) => {
      if (a.coveragePct === null && b.coveragePct === null) return 0;
      if (a.coveragePct === null) return 1;
      if (b.coveragePct === null) return -1;
      return a.coveragePct - b.coveragePct || a.nFacilities - b.nFacilities;
    });
    const shown = sorted.slice(0, MAX_CHILD_ROWS);

    parts.push(
      `<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">${escapeXml(childHeading)}</text>`,
    );
    const cFacilities = MARGIN + INNER - 260;
    const cBrgy = MARGIN + INNER - 120;
    const cCoverage = MARGIN + INNER;
    parts.push(
      `<text x="${cFacilities}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Facilities</text>`,
    );
    parts.push(
      `<text x="${cBrgy}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Barangays with one</text>`,
    );
    parts.push(
      `<text x="${cCoverage}" y="${y}" font-size="10" fill="${MUTED}" text-anchor="end">Coverage</text>`,
    );
    y += 6;
    parts.push(`<line x1="${MARGIN}" y1="${y}" x2="${MARGIN + INNER}" y2="${y}" stroke="${BORDER}"/>`);
    y += 16;
    for (const c of shown) {
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(c.geoName)}</text>`,
      );
      parts.push(
        `<text x="${cFacilities}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${fmt(c.nFacilities)}</text>`,
      );
      parts.push(
        `<text x="${cBrgy}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="end">${fmt(c.nBarangaysWithFacility)} of ${fmt(c.nBarangays)}</text>`,
      );
      parts.push(
        `<text x="${cCoverage}" y="${y}" font-size="11" fill="${INK}" text-anchor="end">${pct(c.coveragePct)}</text>`,
      );
      y += 18;
    }
    if (sorted.length > shown.length) {
      // Sorted least-covered first, so the omitted tail is the higher-covered remainder.
      const rest = sorted.length - shown.length;
      const restFacilities = sorted.slice(shown.length).reduce((sum, c) => sum + c.nFacilities, 0);
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
          `+ ${rest} more with higher coverage, ${fmt(restFacilities)} facilities between them.`,
        )}</text>`,
      );
      y += 18;
    }
    y += 4;
  }

  // ---- City/municipality sheets name their facilities, other than barangay health stations ----
  if (isCitymun && facilities.length > 0) {
    const named = facilities.filter((f) => f.facilityType !== "Barangay Health Station");
    const nStations = facilities.length - named.length;
    if (named.length > 0) {
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="13" font-weight="600" fill="${INK}">Facilities other than barangay health stations</text>`,
      );
      y += 16;
      const shown = named.slice(0, MAX_FACILITY_NAMES);
      const labels = shown.map((f) => `${f.facilityName} (${f.facilityType})`);
      for (const line of wrapNames(labels, 95)) {
        parts.push(
          `<text x="${MARGIN}" y="${y}" font-size="11" fill="${INK}">${escapeXml(line)}</text>`,
        );
        y += 15;
      }
      if (named.length > shown.length) {
        parts.push(
          `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
            `+ ${named.length - shown.length} more.`,
          )}</text>`,
        );
        y += 15;
      }
      if (nStations > 0) {
        parts.push(
          `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
            `${fmt(nStations)} barangay health ${nStations === 1 ? "station is" : "stations are"} not named individually above — see Facility types.`,
          )}</text>`,
        );
        y += 15;
      }
      y += 6;
    }
    if (counts.nFacilities > facilities.length) {
      // getNhfrFacilities is capped at 1,000 rows — say so if the cap ever binds, rather than
      // showing a short list that looks complete (the failure the district export had to fix).
      parts.push(
        `<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(
          `Facility list capped: ${fmt(counts.nFacilities - facilities.length)} facilities are not reflected above.`,
        )}</text>`,
      );
      y += 15;
    }
  }

  // ---- Footer ----
  // Four short lines rather than fewer long ones: SVG text does not wrap, so a single line
  // carrying the full licence-status caveat ran off the canvas edge silently — caught only by
  // rendering the PNG and looking at it, the same class of bug uuc-phc-figure.ts's footer fix
  // (docs/DECISIONS.md's "footerLines, plural") records.
  y += 10;
  const footerLines = [
    `Source: DOH National Health Facility Registry (nhfr.doh.gov.ph), ${NHFR_SNAPSHOT_LABEL} snapshot.`,
    "Licence status is not shown here: most facilities carry no status in the source, overwhelmingly barangay health stations.",
    "A blank never means unlicensed — see the facility list on screen for what the source states per facility.",
    "Coverage counts any facility at all. 108 facilities nationwide carry no barangay code and cannot count toward it.",
  ];
  for (const line of footerLines) {
    parts.push(`<text x="${MARGIN}" y="${y}" font-size="10" fill="${MUTED}">${escapeXml(line)}</text>`);
    y += 14;
  }
  y += 6;

  const height = y + MARGIN;
  // No system fonts on the serverless runtime; every text node inherits the family here so
  // resvg falls back to the bundled DejaVu Sans (see lib/exports/render-png.ts).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g font-family="system-ui, sans-serif">
    ${parts.join("\n    ")}
    </g>
  </svg>`;

  return { svg, filenameParts: [geoName, "health-facilities-2026-09"] };
}

/**
 * Fetches everything `composeNhfrFigureSvg` needs and assembles the one-page summary SVG for a
 * geo. Returns null when the area has no row at all — a read failure, not an area with zero
 * facilities, which is a real result the sheet renders as 0.
 */
export async function buildNhfrFigure(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<NhfrFigure | null> {
  const isCitymun = geoLevel === "citymun";
  const [geo, counts, children, types, facilities] = await Promise.all([
    getGeoByCode(geoCode),
    getNhfrCounts(geoCode, geoLevel),
    getNhfrChildren(geoCode, geoLevel),
    getNhfrTypes(geoCode, geoLevel),
    isCitymun ? getNhfrFacilities(geoCode) : Promise.resolve([]),
  ]);
  if (!counts) return null;

  return composeNhfrFigureSvg({
    geoName: geo?.geoName ?? geoCode,
    geoLevel,
    generated: new Date().toISOString().slice(0, 10),
    counts,
    children,
    types,
    facilities,
  });
}

/** Rasterizes the one-pager SVG to a PNG buffer with the bundled export fonts. */
export async function renderNhfrPng(figure: NhfrFigure): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  return new Resvg(figure.svg, {
    fitTo: { mode: "width", value: WIDTH * 2 },
    font: resvgFont(),
  })
    .render()
    .asPng();
}
