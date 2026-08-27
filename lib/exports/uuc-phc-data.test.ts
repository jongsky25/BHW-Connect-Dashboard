import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { UucPhcListRow } from "@/lib/db/uuc-phc-list";
import {
  BOUNDABLE_INDICATORS,
  UUC_PHC_EXPORT_COLUMNS,
  buildUucPhcExportNotes,
  buildUucPhcExportSubtitle,
  csvCell,
  exportValue,
  renderUucPhcCsv,
  renderUucPhcXlsx,
  summariseCapping,
  uucPhcExportFilename,
  type UucPhcExportMeta,
} from "./uuc-phc-data";

/**
 * U11's whole justification is that a spreadsheet can carry the capping marker where U4's PNG could
 * not. These tests hold that claim in place: the marker column exists, it is adjacent to the values
 * it qualifies, the notes block is computed from the rows rather than quoted, and a file for an area
 * with nothing listed is still a file rather than an absence.
 */

function row(overrides: Partial<UucPhcListRow> = {}): UucPhcListRow {
  return {
    geo_code: "1402706001",
    geo_name: "ALIMIT",
    citymun_code: "1402706",
    citymun_name: "MAYOYAO",
    province_code: "14027",
    province_name: "IFUGAO",
    region_code: "14",
    region_name: "CORDILLERA ADMINISTRATIVE REGION (CAR)",
    source_geo_code: "1402706001",
    source_region: "CAR",
    source_province: "IFUGAO",
    source_citymun: "MAYOYAO",
    source_barangay: "ALIMIT",
    route_ip: true,
    route_conflict: false,
    route_four_ps: true,
    route_health: false,
    health_evaluable: true,
    health_indicators: 2,
    physical_factor: 100,
    ip_pop: 98,
    armed_conf: 0,
    idp: 0,
    four_ps: 61,
    elcac_brgy: false,
    capped_indicators: [],
    imr: 0,
    ufmr: 0,
    abr: 12.5,
    fic: 88,
    pre_natal: 90,
    sba: 95,
    water: 72,
    imr_prov_ref: 8.2,
    ufmr_prov_ref: 9.1,
    abr_prov_ref: 30,
    fic_prov_ref: 71,
    pre_natal_prov_ref: 80,
    sba_prov_ref: 90,
    water_prov_ref: 71.3,
    ...overrides,
  };
}

const META: UucPhcExportMeta = {
  geoCode: "1402706",
  geoLevel: "citymun",
  geoName: "MAYOYAO",
  nListed: 27,
  nBarangays: 27,
  sourceName: "DOH Bureau of Local Health Systems Development",
  license: null,
  asOfDate: "2025-01-01",
  retrievedAt: "2026-08-27T00:00:00.000Z",
};

describe("the export's column table", () => {
  it("names each column once", () => {
    const keys = UUC_PHC_EXPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("describes every column, because the file leaves the building", () => {
    // The XLSX dictionary sheet is the only place a downloaded file explains itself; a column with
    // no meaning is a column a reader has to guess at with no way back to dataset_column.
    for (const column of UUC_PHC_EXPORT_COLUMNS) {
      expect(column.meaning.length, column.key).toBeGreaterThan(20);
    }
  });

  it("leaves out dataset_id, the one column of the view that means nothing in a file", () => {
    // A surrogate FK into dim_dataset, constant down every row. Which dataset the file is gets
    // said in words in the notes block instead.
    expect(UUC_PHC_EXPORT_COLUMNS.map((c) => c.key)).not.toContain("dataset_id");
    expect(UUC_PHC_EXPORT_COLUMNS).toHaveLength(40);
  });

  it("puts capped_indicators immediately before the seven indicators it qualifies", () => {
    // A marker 30 columns to the right of the value is a marker that does not travel with it —
    // which is the failure U4 refused to ship on the PNG for the same reason.
    const keys = UUC_PHC_EXPORT_COLUMNS.map((c) => c.key);
    const marker = keys.indexOf("capped_indicators");
    expect(marker).toBeGreaterThan(-1);
    for (const indicator of BOUNDABLE_INDICATORS) {
      expect(keys.indexOf(indicator), indicator).toBeGreaterThan(marker);
    }
    expect(keys[marker + 1]).toBe("imr");
  });

  it("carries the capping caveat on every boundable indicator and on none of the benchmarks", () => {
    // The benchmarks were never capped, which is exactly why FIC's reads above 100 in two
    // provinces while every barangay FIC was bounded to it. Describing both as bounded hides that.
    for (const indicator of BOUNDABLE_INDICATORS) {
      const column = UUC_PHC_EXPORT_COLUMNS.find((c) => c.key === indicator);
      expect(column?.meaning, indicator).toMatch(/capped_indicators/);
    }
    for (const column of UUC_PHC_EXPORT_COLUMNS.filter((c) => c.key.endsWith("_prov_ref"))) {
      expect(column.meaning, column.key).toMatch(/NEVER capped/);
    }
  });

  it("says a route flag is false for a missing value, not only for a low one", () => {
    // The three socio-economic routes read a null as 0, matching agg_uuc_phc_criteria, so a
    // downloaded file's flags add up to the counts /uuc-phc/criteria prints. The per-barangay
    // disclosure renders the same null as "—", and a reader comparing the two needs to be told.
    const joined = UUC_PHC_EXPORT_COLUMNS.filter((c) => c.key.startsWith("route_"))
      .map((c) => c.meaning)
      .join(" ");
    expect(joined).toMatch(/FALSE WHERE THE VALUE BEHIND IT IS MISSING/);
  });

  it("warns that the four routes overlap, on every route column", () => {
    const routes = UUC_PHC_EXPORT_COLUMNS.filter((c) => c.key.startsWith("route_"));
    expect(routes).toHaveLength(4);
    const joined = routes.map((c) => c.meaning).join(" ");
    expect(joined).toMatch(/OVERLAP|never be summed|health_evaluable/);
  });
});

describe("summariseCapping", () => {
  it("counts barangays and values separately", () => {
    // 1,584 values fall across 1,397 barangays nationally because some carry several. Collapsing
    // the two overstates how much of the list is affected — the U10 finding, at file scale.
    const summary = summariseCapping([
      row({ capped_indicators: ["water"] }),
      row({ capped_indicators: ["fic", "water"] }),
      row({ capped_indicators: [] }),
    ]);
    expect(summary.nBarangays).toBe(2);
    expect(summary.nValues).toBe(3);
    expect(summary.byIndicator).toEqual([
      { indicator: "water", n: 2 },
      { indicator: "fic", n: 1 },
    ]);
  });

  it("leaves out indicators with nothing bounded rather than printing zeroes", () => {
    const summary = summariseCapping([row({ capped_indicators: ["sba"] })]);
    expect(summary.byIndicator.map((c) => c.indicator)).toEqual(["sba"]);
  });

  it("reports nothing for rows with nothing bounded", () => {
    expect(summariseCapping([row(), row()])).toEqual({
      nBarangays: 0,
      nValues: 0,
      byIndicator: [],
    });
  });
});

describe("the notes block", () => {
  it("counts what this file contains rather than quoting the national totals", () => {
    // A header that typed "1,584 across 1,397" onto a municipal file would be a wrong figure, and a
    // typed one drifts the first time the extract is regenerated. This is U10's rule, in a file.
    const notes = buildUucPhcExportNotes(
      [row({ capped_indicators: ["water"] }), row({ capped_indicators: ["water", "fic"] })],
      META,
    ).join("\n");
    expect(notes).toMatch(/3 value\(s\) across 2 of the 2 barangay row\(s\)/);
    expect(notes).toMatch(/water 2, fic 1/);
    expect(notes).not.toMatch(/1,584/);
    expect(notes).not.toMatch(/1,397/);
  });

  it("leads with the capping caveat, so an XLSX shows it without scrolling", () => {
    expect(buildUucPhcExportNotes([row()], META)[0]).toMatch(/^BOUNDED VALUES:/);
  });

  it("says so plainly when nothing in this file was bounded", () => {
    // Silence would read as "no capping in this dataset", which is false and is the one thing this
    // block exists to prevent.
    const first = buildUucPhcExportNotes([row()], META)[0];
    expect(first).toMatch(/none of the 1 barangay row/);
    expect(first).toMatch(/ceiling the source overshot/);
  });

  it("names the rows criterion (d) could not be evaluated for", () => {
    const notes = buildUucPhcExportNotes(
      [row(), row({ health_evaluable: false, route_health: false })],
      META,
    ).join("\n");
    expect(notes).toMatch(/NOT EVALUABLE FOR 1 OF THESE ROWS/);
    expect(notes).toMatch(/not because it failed/);
  });

  it("does not claim a licence the dataset row does not state", () => {
    // This file travels further from anyone who could correct it than any page does, so an invented
    // licence is the worst possible place to put one.
    expect(buildUucPhcExportNotes([row()], META)).toContain("Licence: not stated by the source");
    expect(buildUucPhcExportNotes([row()], { ...META, license: "CC BY 4.0" })).toContain(
      "Licence: CC BY 4.0",
    );
  });

  it("carries the source, the issuing circular and the retrieval time", () => {
    const notes = buildUucPhcExportNotes([row()], META).join("\n");
    expect(notes).toMatch(/DC No\. 2025-0549/);
    expect(notes).toMatch(/DOH AO No\. 2020-0023/);
    expect(notes).toMatch(/Bureau of Local Health Systems Development/);
    expect(notes).toMatch(/Retrieved: 2026-08-27T00:00:00\.000Z/);
    expect(notes).toMatch(/\/uuc-phc\/data-quality/);
  });

  it("says the four routes must never be summed", () => {
    expect(buildUucPhcExportNotes([row()], META).join("\n")).toMatch(/never be summed/);
  });

  it("says health_indicators is the source's score, not a derivation", () => {
    expect(buildUucPhcExportNotes([row()], META).join("\n")).toMatch(
      /SOURCE OFFICE'S OWN SCORE, not a derivation/,
    );
  });
});

describe("cell rendering", () => {
  it("quotes a name carrying a comma", () => {
    // Four barangay names in the live list carry one, so this is load-bearing.
    expect(csvCell("CITY OF ISABELA, BASILAN")).toBe('"CITY OF ISABELA, BASILAN"');
    expect(csvCell("MAYOYAO")).toBe("MAYOYAO");
    expect(csvCell('SAY "HI"')).toBe('"SAY ""HI"""');
  });

  it("renders a null as an empty cell, never a zero", () => {
    // The source left it blank; a 0 would assert a measurement it never made.
    const column = UUC_PHC_EXPORT_COLUMNS.find((c) => c.key === "ip_pop")!;
    expect(exportValue(row({ ip_pop: null }), column)).toBe("");
    expect(exportValue(row({ ip_pop: 0 }), column)).toBe("0");
  });

  it("pipe-separates capped_indicators, matching the committed extract's own encoding", () => {
    const column = UUC_PHC_EXPORT_COLUMNS.find((c) => c.key === "capped_indicators")!;
    expect(exportValue(row({ capped_indicators: ["fic", "water"] }), column)).toBe("fic|water");
    expect(exportValue(row({ capped_indicators: [] }), column)).toBe("");
  });
});

describe("renderUucPhcCsv", () => {
  it("puts every note in the comment block and the columns in the header row", () => {
    const csv = renderUucPhcCsv([row()], META);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("# UUC for PHC 2025 — MAYOYAO");
    const header = lines.find((l) => l.startsWith("geo_code"));
    expect(header).toBe(UUC_PHC_EXPORT_COLUMNS.map((c) => c.key).join(","));
    for (const line of lines) {
      if (line === header) break;
      expect(line.startsWith("#")).toBe(true);
    }
  });

  it("emits one data row per barangay, in the order given", () => {
    const csv = renderUucPhcCsv([row({ geo_code: "A" }), row({ geo_code: "B" })], META);
    const data = csv.trimEnd().split("\n").slice(-2);
    expect(data.map((line) => line.split(",")[0])).toEqual(["A", "B"]);
  });

  it("still emits a header for an area with nothing listed", () => {
    // NCR's 0 of 1,675 is a finding, not a missing export — the plan's Verify case.
    const csv = renderUucPhcCsv([], { ...META, geoName: "NCR", nListed: 0, nBarangays: 1675 });
    expect(csv).toMatch(/^# UUC for PHC 2025 — NCR/);
    expect(csv).toMatch(/0 of the area's 1,675 barangays/);
    expect(csv.trimEnd().split("\n").at(-1)).toBe(
      UUC_PHC_EXPORT_COLUMNS.map((c) => c.key).join(","),
    );
  });

  it("keeps a comma inside a name out of the column count", () => {
    const csv = renderUucPhcCsv([row({ geo_name: "SAN ANTONIO, PILAR" })], META);
    expect(csv).toMatch(/"SAN ANTONIO, PILAR"/);
  });
});

describe("buildUucPhcExportSubtitle", () => {
  it("states the rows against the area's own barangay count", () => {
    expect(buildUucPhcExportSubtitle(META, 27)).toBe(
      "City / Municipality: MAYOYAO — 27 of the area's 27 barangays are on the 2025 UUC for PHC list.",
    );
  });
});

describe("uucPhcExportFilename", () => {
  it("names the dataset, the rows and the area", () => {
    expect(uucPhcExportFilename(META, "csv")).toBe("uuc-phc-2025-listed-barangays-mayoyao.csv");
    expect(uucPhcExportFilename({ ...META, geoName: "Philippines" }, "xlsx")).toBe(
      "uuc-phc-2025-listed-barangays-philippines.xlsx",
    );
  });
});

describe("renderUucPhcXlsx", () => {
  async function readBack(rows: UucPhcListRow[], meta = META) {
    const buffer = await renderUucPhcXlsx(rows, meta);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  it("shows the capping caveat in the first rows of the sheet the file opens on", async () => {
    // The plan asks for the caveat to be visible without scrolling; a second sheet is one click
    // away and routinely never opened.
    const workbook = await readBack([row({ capped_indicators: ["water"] })]);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe("Listed barangays");
    expect(String(sheet.getCell("A1").value)).toContain("UUC for PHC 2025");
    expect(String(sheet.getCell("A3").value)).toMatch(/^BOUNDED VALUES:/);
  });

  it("writes the header row after the notes and freezes above the data", async () => {
    const workbook = await readBack([row()]);
    const sheet = workbook.worksheets[0];
    const headerRowNumber = sheet.views[0]?.state === "frozen" ? sheet.views[0].ySplit : 0;
    expect(headerRowNumber).toBeGreaterThan(1);
    const header = sheet.getRow(headerRowNumber!);
    expect(header.getCell(1).value).toBe("geo_code");
    expect(header.getCell(UUC_PHC_EXPORT_COLUMNS.length).value).toBe("water_prov_ref");
  });

  it("keeps numbers and booleans typed, so a reader can sort and filter them", async () => {
    const workbook = await readBack([row({ water: 72.5, route_ip: true })]);
    const sheet = workbook.worksheets[0];
    const keys = UUC_PHC_EXPORT_COLUMNS.map((c) => c.key);
    const dataRow = sheet.getRow(sheet.rowCount);
    expect(dataRow.getCell(keys.indexOf("water") + 1).value).toBe(72.5);
    expect(dataRow.getCell(keys.indexOf("route_ip") + 1).value).toBe(true);
    expect(dataRow.getCell(keys.indexOf("geo_code") + 1).value).toBe("1402706001");
  });

  it("shades the bounded value in place, and only that value", async () => {
    // The marker reaching the cell itself is the thing a spreadsheet can do that a PNG cannot.
    // capped_indicators stays authoritative — shading does not survive a copy-paste.
    const workbook = await readBack([row({ capped_indicators: ["water"], water: 100 })]);
    const sheet = workbook.worksheets[0];
    const keys = UUC_PHC_EXPORT_COLUMNS.map((c) => c.key);
    const dataRow = sheet.getRow(sheet.rowCount);
    const filled = (key: (typeof UUC_PHC_EXPORT_COLUMNS)[number]["key"]) => {
      const fill = dataRow.getCell(keys.indexOf(key) + 1).fill;
      return fill?.type === "pattern" && fill.pattern === "solid";
    };
    expect(filled("water")).toBe(true);
    expect(filled("fic")).toBe(false);
    expect(filled("water_prov_ref")).toBe(false);
  });

  it("carries the full column dictionary on its own sheet", async () => {
    const workbook = await readBack([row()]);
    const about = workbook.getWorksheet("About this data");
    expect(about).toBeDefined();
    const labels = new Set<string>();
    about!.eachRow((r) => labels.add(String(r.getCell(1).value ?? "")));
    for (const column of UUC_PHC_EXPORT_COLUMNS)
      expect(labels.has(column.key), column.key).toBe(true);
  });

  it("produces a valid workbook for an area with nothing listed", async () => {
    const workbook = await readBack([], { ...META, geoName: "NCR", nListed: 0, nBarangays: 1675 });
    const sheet = workbook.worksheets[0];
    expect(String(sheet.getCell("A2").value)).toMatch(/0 of the area's 1,675 barangays/);
    const header = sheet.getRow(sheet.rowCount);
    expect(header.getCell(1).value).toBe("geo_code");
  });
});
