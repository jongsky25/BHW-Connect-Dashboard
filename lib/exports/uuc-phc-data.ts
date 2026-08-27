import ExcelJS from "exceljs";
import type { UucPhcListRow } from "@/lib/db/uuc-phc-list";
import type { GeoLevel } from "@/lib/filters/schema";
import { slugify } from "./query";

/**
 * UUC for PHC 2025 — the list as a spreadsheet (plan U11).
 *
 * The one-pager U4 built is a picture, and anyone doing work with this list needs the rows. This
 * module turns `ref_uuc_phc_list` into a CSV or an XLSX for a chosen area.
 *
 * **Why this is allowed to carry indicator values when the PNG is not.** U3's rule is *mark the
 * value, never average it*: 1,584 values across 1,397 barangays were bounded during cleaning, and
 * once bounded a Water reading of exactly 100 is indistinguishable from genuine full coverage.
 * U4 kept the values off the one-pager because a 794-pixel sheet has nowhere to carry the † marker
 * and its footnote, and reproducing bounded values without it is exactly the unmarked artefact U3
 * was built to avoid. A spreadsheet *does* have somewhere: `capped_indicators` is a column of its
 * own, sitting immediately before the seven indicators it qualifies, and a notes block above the
 * data says what a named value means. This is not a relaxation of U4's rule — it is the same rule
 * in a format that can satisfy it.
 *
 * **Every figure in the notes block is computed from the rows in the file**, never quoted from the
 * cleaning report. A header that typed "1,584 values across 1,397 barangays" would be the national
 * total printed on a file about one municipality, and would drift the first time the extract is
 * regenerated — the same reasoning that decided the whole shape of `/uuc-phc/data-quality` (U10).
 * A Mayoyao file says how many of *its* 27 rows carry a bounded value.
 */

/** The seven indicators that could be bounded during cleaning. The five socio-economic measures and
 * the physical factor never were, so naming them here would invent a caveat. */
export const BOUNDABLE_INDICATORS = [
  "imr",
  "ufmr",
  "abr",
  "fic",
  "pre_natal",
  "sba",
  "water",
] as const;

export type UucPhcExportFormat = "csv" | "xlsx";

type ColumnKind = "text" | "number" | "boolean" | "list";

export type UucPhcExportColumn = {
  key: keyof UucPhcListRow;
  kind: ColumnKind;
  /** What the column means, in one line. Rendered as a dictionary on the XLSX "About this data"
   * sheet — the file leaves the building, so the meanings have to travel with it rather than
   * living only in `dataset_column`. */
  meaning: string;
};

/**
 * The export's column order — one definition, read by the CSV writer, the XLSX writer and the
 * dictionary sheet alike.
 *
 * Names are `ref_uuc_phc_list`'s verbatim, so a downloaded file and the relation it came from can
 * be checked against each other column for column. `geo_name` is the barangay's; the dictionary
 * sheet says so, which is a better answer than renaming a column and breaking that correspondence.
 *
 * The order is deliberate: identity, then provenance, then *why this barangay is on the list*
 * (the four routes), then the measurements. `capped_indicators` sits **immediately before the seven
 * boundable indicators**, because a marker a reader has to scroll 30 columns to find is a marker
 * that does not travel with the value.
 *
 * `dataset_id` is the one column of the view left out: it is a surrogate key into `dim_dataset`,
 * constant down every file, and meaningless to anyone who is not holding this database. The notes
 * block and the dictionary sheet say which dataset the file is, in words.
 */
export const UUC_PHC_EXPORT_COLUMNS: readonly UucPhcExportColumn[] = [
  // Identity and geography, resolved against dim_geo.
  {
    key: "geo_code",
    kind: "text",
    meaning: "PSGC code of the barangay, on the dashboard's PSGC vintage. The file's primary key.",
  },
  { key: "geo_name", kind: "text", meaning: "Official PSA name of the barangay." },
  { key: "citymun_code", kind: "text", meaning: "PSGC code of the city or municipality." },
  { key: "citymun_name", kind: "text", meaning: "Official PSA name of the city or municipality." },
  { key: "province_code", kind: "text", meaning: "PSGC code of the province." },
  { key: "province_name", kind: "text", meaning: "Official PSA name of the province." },
  { key: "region_code", kind: "text", meaning: "PSGC code of the region." },
  { key: "region_name", kind: "text", meaning: "Official PSA name of the region." },

  // Provenance: the workbook's own identifiers and names, kept so a row can be traced back.
  {
    key: "source_geo_code",
    kind: "text",
    meaning:
      "PSGC code exactly as the source workbook supplies it. Differs from geo_code for Sulu's 87 barangays, which the source files under Region IX and the dashboard under BARMM.",
  },
  {
    key: "source_region",
    kind: "text",
    meaning: "Region name as the source workbook wrote it — provenance, not a display name.",
  },
  {
    key: "source_province",
    kind: "text",
    meaning:
      "Province name as the source workbook wrote it. 9 of its 88 groups do not match PSA names.",
  },
  {
    key: "source_citymun",
    kind: "text",
    meaning: "City/municipality name as the source workbook wrote it.",
  },
  {
    key: "source_barangay",
    kind: "text",
    meaning: "Barangay name as the source workbook wrote it.",
  },

  // The four qualifying routes of DOH AO No. 2020-0023 §VI.A.
  {
    key: "route_ip",
    kind: "boolean",
    meaning:
      "Criterion (a): at least 10% of the population are Indigenous Peoples. THE FOUR ROUTES OVERLAP — a barangay can qualify on several, so they do not partition the list and must never be added together.",
  },
  {
    key: "route_conflict",
    kind: "boolean",
    meaning:
      "Criterion (b): armed conflict and displacement together reach 10% of the population, or the barangay is ELCAC-designated. The two percentages are summed rather than read as the order's 'or' — that is what reproduces the source's own Pass/Fail on all 5,991 rows.",
  },
  {
    key: "route_four_ps",
    kind: "boolean",
    meaning:
      "Criterion (c): at least 50% of the population enrolled in 4Ps/CCT. A ROUTE FLAG IS FALSE WHERE THE VALUE BEHIND IT IS MISSING as well as where it is below the threshold — absence of evidence is counted as not qualifying, which is what makes these flags add up to the counts on /uuc-phc/criteria. Read ip_pop, armed_conf, idp and four_ps in the same row to tell the two apart.",
  },
  {
    key: "route_health",
    kind: "boolean",
    meaning:
      "Criterion (d): the source office's own health_indicators score is at least 4 of 7. READ health_evaluable BESIDE IT — where that is false the comparison was not made at all, and false here is not a failed test.",
  },
  {
    key: "health_evaluable",
    kind: "boolean",
    meaning:
      "Whether criterion (d) can be evaluated for this barangay. False for 226 barangays in 5 provinces whose provincial benchmarks are placeholders, zeroes, fractions or absent. Exclude these rows from any denominator for route_health.",
  },
  {
    key: "health_indicators",
    kind: "number",
    meaning:
      "The source office's own criterion (d) score, 0-7, loaded as supplied. NOT RECOMPUTABLE from the indicator columns in this file: the source scored it before cleaning bounded the values, so a recomputation disagrees on 664 barangays and would leave 98 qualifying on no route at all.",
  },

  // The physical factor and the socio-economic measures. None of these was ever bounded.
  {
    key: "physical_factor",
    kind: "number",
    meaning:
      "% of the barangay's sitios or puroks more than 60 minutes from a health facility. At least 25 in every row: below the AO's floor a barangay never entered the list.",
  },
  { key: "ip_pop", kind: "number", meaning: "% of the population who are Indigenous Peoples." },
  { key: "armed_conf", kind: "number", meaning: "% of the population affected by armed conflict." },
  { key: "idp", kind: "number", meaning: "% of the population internally displaced." },
  { key: "four_ps", kind: "number", meaning: "% of the population enrolled in 4Ps/CCT." },
  {
    key: "elcac_brgy",
    kind: "boolean",
    meaning: "Designated a conflict-affected barangay under ELCAC.",
  },

  // The marker, then the values it qualifies.
  {
    key: "capped_indicators",
    kind: "list",
    meaning:
      "Which of this barangay's indicators were BOUNDED during cleaning, pipe-separated; blank where none were. A named value is a ceiling the source overshot, not a measurement — the source recorded Water as high as 9,594% and FIC as 18,088, and those were bounded to 100 (coverage) or 1,000 (rates). Read this column before quoting any of the seven indicators below, and never average a column without excluding or footnoting the rows named here.",
  },
  {
    key: "imr",
    kind: "number",
    meaning:
      "Infant mortality, per 1,000 live births. Bounded at 1,000 where capped_indicators names imr.",
  },
  {
    key: "ufmr",
    kind: "number",
    meaning:
      "Under-five mortality, per 1,000 live births. Bounded at 1,000 where capped_indicators names ufmr.",
  },
  {
    key: "abr",
    kind: "number",
    meaning:
      "Adolescent birth rate, per 1,000 women aged 10-19. Bounded at 1,000 where capped_indicators names abr.",
  },
  {
    key: "fic",
    kind: "number",
    meaning:
      "Fully immunised children, %. Bounded at 100 where capped_indicators names fic — 456 readings, which now read as exactly 100%.",
  },
  {
    key: "pre_natal",
    kind: "number",
    meaning: "4+ pre-natal visits, %. Bounded at 100 where capped_indicators names pre_natal.",
  },
  {
    key: "sba",
    kind: "number",
    meaning: "Skilled birth attendance, %. Bounded at 100 where capped_indicators names sba.",
  },
  {
    key: "water",
    kind: "number",
    meaning:
      "Improved water supply, %. Bounded at 100 where capped_indicators names water — 886 readings, which now read as exactly 100%.",
  },

  // The provincial benchmarks criterion (d) compares against.
  {
    key: "imr_prov_ref",
    kind: "number",
    meaning:
      "The province's infant mortality figure, which criterion (d) compares imr against. NEVER capped.",
  },
  {
    key: "ufmr_prov_ref",
    kind: "number",
    meaning: "The province's under-five mortality figure. NEVER capped.",
  },
  {
    key: "abr_prov_ref",
    kind: "number",
    meaning: "The province's adolescent birth rate. NEVER capped.",
  },
  {
    key: "fic_prov_ref",
    kind: "number",
    meaning:
      "The province's fully-immunised-children figure. NEVER capped — which is why it reads above 100 in Ilocos Sur (102.15) and City of Butuan (100.96) while every barangay fic was bounded to 100. No barangay in those two provinces can reach it, so a worse-than-province verdict there would be true by construction.",
  },
  {
    key: "pre_natal_prov_ref",
    kind: "number",
    meaning: "The province's 4+ pre-natal visits figure. NEVER capped.",
  },
  {
    key: "sba_prov_ref",
    kind: "number",
    meaning: "The province's skilled-birth-attendance figure. NEVER capped.",
  },
  {
    key: "water_prov_ref",
    kind: "number",
    meaning: "The province's improved-water-supply figure. NEVER capped.",
  },
];

export type UucPhcExportMeta = {
  geoCode: string;
  geoLevel: GeoLevel;
  /** Display name of the area, from dim_geo. */
  geoName: string;
  /** The area's listed count, from `agg_uuc_phc_counts` — the figure the file must contain. */
  nListed: number;
  /** Every barangay in the area, the share's denominator. */
  nBarangays: number;
  sourceName: string | null;
  license: string | null;
  asOfDate: string | null;
  /** ISO timestamp the file was generated at. Passed in rather than read from the clock here, so
   * the notes block is a pure function of its inputs and can be tested. */
  retrievedAt: string;
};

const LEVEL_LABEL: Record<GeoLevel, string> = {
  national: "National",
  region: "Region",
  province: "Province",
  citymun: "City / Municipality",
  barangay: "Barangay",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export type CappingSummary = {
  /** Rows in this file carrying at least one bounded value. */
  nBarangays: number;
  /** Bounded values in this file. Larger than `nBarangays` wherever a barangay carries several —
   * which is why the two are counted separately and never presented as one figure. */
  nValues: number;
  /** Per indicator, largest first; indicators with none are left out rather than printed as zero. */
  byIndicator: { indicator: string; n: number }[];
};

/**
 * What was bounded in *this file*. Computed from the rows, never quoted from the cleaning report:
 * a national constant printed on a municipal file is a wrong figure, and a typed one drifts the
 * first time the extract is regenerated.
 */
export function summariseCapping(rows: readonly UucPhcListRow[]): CappingSummary {
  const counts = new Map<string, number>();
  let nBarangays = 0;
  let nValues = 0;
  for (const row of rows) {
    const capped = row.capped_indicators ?? [];
    if (capped.length === 0) continue;
    nBarangays += 1;
    nValues += capped.length;
    for (const indicator of capped) counts.set(indicator, (counts.get(indicator) ?? 0) + 1);
  }
  const byIndicator = [...counts.entries()]
    .map(([indicator, n]) => ({ indicator, n }))
    // Largest first, then alphabetically, so the order is total rather than insertion-dependent.
    .sort((a, b) => b.n - a.n || a.indicator.localeCompare(b.indicator));
  return { nBarangays, nValues, byIndicator };
}

/**
 * The notes block: what this file is, where it came from, and what must not be done with it.
 *
 * One sentence per line, in the order a reader needs them — the capping caveat **first**, directly
 * under the title, because on the XLSX it has to be readable without scrolling and because it is
 * the reason this export is allowed to carry indicator values at all.
 *
 * Every number here is counted from `rows`. The one exception is `nListed`, which comes from
 * `agg_uuc_phc_counts` and is printed precisely so a reader can check it against the row count the
 * file actually contains — the route refuses to emit when the two disagree.
 */
export function buildUucPhcExportNotes(
  rows: readonly UucPhcListRow[],
  meta: UucPhcExportMeta,
): string[] {
  const capping = summariseCapping(rows);
  const notes: string[] = [];

  if (capping.nValues > 0) {
    const perIndicator = capping.byIndicator.map((c) => `${c.indicator} ${fmt(c.n)}`).join(", ");
    notes.push(
      `BOUNDED VALUES: ${fmt(capping.nValues)} value(s) across ${fmt(capping.nBarangays)} of the ${fmt(rows.length)} barangay row(s) in this file were bounded during cleaning (${perIndicator}). A bounded value is a ceiling the source overshot, not a measurement — the source recorded figures as high as 9,594% — so it now reads at exactly 100 (coverage) or 1,000 (rates) with nothing else to separate it from a genuine one. The capped_indicators column names them, per barangay. Exclude or footnote those rows in any average, or the result will report coverage the source data does not support.`,
    );
  } else {
    notes.push(
      `BOUNDED VALUES: none of the ${fmt(rows.length)} barangay row(s) in this file carries a value bounded during cleaning. Elsewhere in this dataset such values exist, and the capped_indicators column names them per barangay; here it is empty throughout. A bounded value is a ceiling the source overshot, not a measurement.`,
    );
  }

  notes.push(
    `THE FOUR ROUTES OVERLAP: route_ip, route_conflict, route_four_ps and route_health are not four slices of one whole — a barangay can qualify on several at once — so they must never be summed, stacked, or used to derive a remainder.`,
  );

  const notEvaluable = rows.filter((r) => !r.health_evaluable).length;
  notes.push(
    notEvaluable > 0
      ? `CRITERION (d) IS NOT EVALUABLE FOR ${fmt(notEvaluable)} OF THESE ROWS: their province supplied benchmarks that are placeholders, zeroes, fractions or absent, so route_health is false there because the comparison was never made, not because it failed. Exclude those rows from route_health's denominator — health_evaluable marks them.`
      : `CRITERION (d) IS EVALUABLE FOR EVERY ROW IN THIS FILE: health_evaluable is true throughout, so route_health's denominator is the full row count here. That is not true dataset-wide — 226 barangays in 5 provinces cannot support the comparison at all.`,
  );

  notes.push(
    `health_indicators IS THE SOURCE OFFICE'S OWN SCORE, not a derivation from the columns beside it. It was scored before cleaning bounded the values, so recomputing it from this file disagrees on 664 barangays nationally and would leave 98 listed barangays qualifying on no route at all — which DOH AO No. 2020-0023 makes impossible.`,
  );

  notes.push(
    `MEMBERSHIP IS PRESENCE: every row here is a barangay ON the 2025 list. Barangays that were assessed and not listed are not in this dataset at all, so the absence of a barangay means it is not on the list — not that it was found adequate.`,
  );

  notes.push(
    `Source: ${meta.sourceName ?? "Department of Health (DOH) Bureau of Local Health Systems Development"}`,
  );
  notes.push(`Issued under: DC No. 2025-0549 · criteria per DOH AO No. 2020-0023`);
  // The dataset row carries no licence today. Saying so is a fact; naming one would be an
  // invention, and this file is the copy that travels furthest from anyone who could correct it.
  notes.push(`Licence: ${meta.license ?? "not stated by the source"}`);
  notes.push(`As of: ${meta.asOfDate ?? "not stated by the source"}`);
  notes.push(`Retrieved: ${meta.retrievedAt}`);
  notes.push(
    `Definitions, denominators and what is known to be wrong with this data: /uuc-phc/methodology and /uuc-phc/data-quality`,
  );

  return notes;
}

/** The one-line description of what the file covers, printed under the title. */
export function buildUucPhcExportSubtitle(meta: UucPhcExportMeta, nRows: number): string {
  const scope = `${LEVEL_LABEL[meta.geoLevel]}: ${meta.geoName}`;
  return `${scope} — ${fmt(nRows)} of the area's ${fmt(meta.nBarangays)} barangays are on the 2025 UUC for PHC list.`;
}

/** RFC 4180 quoting. 4 barangay names carry a comma, so this is load-bearing rather than
 * defensive; quotes and newlines are handled for the same reason even though none occurs today. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** One row value, rendered for a text format. Null is an empty cell — the source left it blank,
 * and a 0 would assert a measurement. `capped_indicators` is pipe-separated to match the committed
 * extract's own encoding, so a downloaded file and `ingestion/data/uuc_phc_2025_cleaned.csv` can be
 * compared without a parsing step in between. */
export function exportValue(row: UucPhcListRow, column: UucPhcExportColumn): string {
  const raw = row[column.key];
  if (raw === null || raw === undefined) return "";
  if (column.kind === "list") return Array.isArray(raw) ? raw.join("|") : String(raw);
  return String(raw);
}

/**
 * The CSV: a `#`-prefixed notes block, then the header row, then the rows — the same header-comment
 * convention `/api/export/csv` already uses, carrying this dataset's own caveats instead of the
 * BHW benchmark lines.
 *
 * An area with nothing listed still gets its notes and its header row, and no data rows. That is a
 * valid file describing a real result: NCR's 0 of 1,675 is a finding, not a missing export.
 */
export function renderUucPhcCsv(rows: readonly UucPhcListRow[], meta: UucPhcExportMeta): string {
  const lines = [
    `# UUC for PHC 2025 — ${meta.geoName}`,
    `# ${buildUucPhcExportSubtitle(meta, rows.length)}`,
    ...buildUucPhcExportNotes(rows, meta).map((note) => `# ${note}`),
    "#",
    UUC_PHC_EXPORT_COLUMNS.map((c) => c.key).join(","),
  ];
  for (const row of rows) {
    lines.push(UUC_PHC_EXPORT_COLUMNS.map((c) => csvCell(exportValue(row, c))).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Fill for a cell holding a bounded value. A secondary aid, never the guarantee:
 * `capped_indicators` is what survives a copy-paste, a re-save as CSV, or a colour-blind reader. */
const CAPPED_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF0D8" },
};

/**
 * The XLSX: a "Listed barangays" sheet whose first rows are the notes, and an "About this data"
 * sheet carrying the full column dictionary.
 *
 * **The notes sit above the data rather than only on the second sheet.** A second sheet is one
 * click away and routinely never opened; the plan's requirement is that the capping caveat is
 * visible without scrolling, which means row 3 of the sheet the file opens on.
 *
 * Bounded values are additionally shaded in place, which is the thing a spreadsheet can do that
 * U4's PNG could not — the marker reaching the value itself rather than only a column beside it.
 * The column stays authoritative: shading does not survive a copy-paste and a reader may not see
 * colour at all.
 */
export async function renderUucPhcXlsx(
  rows: readonly UucPhcListRow[],
  meta: UucPhcExportMeta,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BHW Connect";
  workbook.created = new Date(meta.retrievedAt);

  const sheet = workbook.addWorksheet("Listed barangays");
  const lastColumn = UUC_PHC_EXPORT_COLUMNS.length;

  const titleRow = sheet.addRow([`UUC for PHC 2025 — ${meta.geoName}`]);
  titleRow.font = { bold: true, size: 14 };
  const subtitleRow = sheet.addRow([buildUucPhcExportSubtitle(meta, rows.length)]);
  subtitleRow.font = { italic: true, color: { argb: "FF57616A" } };

  for (const note of buildUucPhcExportNotes(rows, meta)) {
    const row = sheet.addRow([note]);
    // Merged across the data's full width so a long caveat reads as a paragraph rather than
    // disappearing behind the neighbouring cell.
    sheet.mergeCells(row.number, 1, row.number, lastColumn);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.font = { size: 10, color: { argb: "FF57616A" } };
  }
  sheet.addRow([]);

  const headerRow = sheet.addRow(UUC_PHC_EXPORT_COLUMNS.map((c) => c.key));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F7F8" } };
  });
  // Freeze above the first data row, so the column names stay put while the rows scroll. An
  // autofilter over the header lets a reader isolate, say, every row with a bounded water value.
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];
  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: lastColumn },
  };

  for (const row of rows) {
    const capped = new Set(row.capped_indicators ?? []);
    const excelRow = sheet.addRow(
      UUC_PHC_EXPORT_COLUMNS.map((column) => {
        const raw = row[column.key];
        if (raw === null || raw === undefined) return null;
        // Numbers and booleans stay typed so a reader can sort and filter them; text and the
        // pipe-joined capped list go through the same renderer the CSV uses, so the two formats
        // cannot disagree about a value.
        if (column.kind === "number" || column.kind === "boolean") return raw as number | boolean;
        return exportValue(row, column);
      }),
    );
    if (capped.size === 0) continue;
    UUC_PHC_EXPORT_COLUMNS.forEach((column, i) => {
      if (capped.has(column.key)) excelRow.getCell(i + 1).fill = CAPPED_FILL;
    });
  }

  sheet.columns.forEach((column, i) => {
    // Wide enough for a name, wider for the marker column, which holds up to four indicator names.
    const key = UUC_PHC_EXPORT_COLUMNS[i]?.key;
    column.width = key === "capped_indicators" ? 30 : key?.endsWith("_name") ? 28 : 16;
  });

  const about = workbook.addWorksheet("About this data");
  const aboutRows: [string, string][] = [
    [
      "Dataset",
      "UUC for PHC 2025 — the 2025 list of Unserved and Underserved Communities for Primary Health Care",
    ],
    ["Relation", "ref_uuc_phc_list — column names in this file are that relation's, verbatim"],
    ["Scope", buildUucPhcExportSubtitle(meta, rows.length)],
    ...buildUucPhcExportNotes(rows, meta).map((note): [string, string] => ["Note", note]),
    ["", ""],
    ["Column", "Meaning"],
    ...UUC_PHC_EXPORT_COLUMNS.map((c): [string, string] => [c.key, c.meaning]),
  ];
  for (const [label, value] of aboutRows) {
    const row = about.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  about.columns = [{ width: 22 }, { width: 110 }];

  return workbook.xlsx.writeBuffer();
}

/** `uuc-phc-2025-listed-barangays-<area>.<ext>`, on the section's existing `slugify` convention. */
export function uucPhcExportFilename(meta: UucPhcExportMeta, format: UucPhcExportFormat): string {
  return `${slugify("uuc-phc-2025-listed-barangays", meta.geoName)}.${format}`;
}
