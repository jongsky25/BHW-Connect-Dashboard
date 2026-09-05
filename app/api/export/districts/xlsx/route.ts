import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getDistrictMappingExport } from "@/lib/db/districts";

export const runtime = "nodejs";

/** XLSX counterpart of `/api/export/districts/csv` — see that route's comment for the "why". */
export async function GET() {
  const rows = await getDistrictMappingExport();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BHW Connect";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Mapping");
  sheet.columns = [
    { header: "District code", key: "districtCode", width: 14 },
    { header: "District name", key: "districtName", width: 28 },
    { header: "Congress", key: "congressNo", width: 10 },
    { header: "Region", key: "regionName", width: 20 },
    { header: "Member geo code", key: "memberGeoCode", width: 16 },
    { header: "Member name", key: "memberGeoName", width: 28 },
    { header: "Member level", key: "memberGeoLevel", width: 12 },
    { header: "Match method", key: "matchMethod", width: 16 },
    { header: "Source kind", key: "sourceKind", width: 14 },
    { header: "Source ref", key: "sourceRef", width: 40 },
    { header: "Retrieved at", key: "retrievedAt", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow({
      districtCode: r.districtCode,
      districtName: r.districtName,
      congressNo: r.congressNo,
      regionName: r.regionName ?? "",
      memberGeoCode: r.memberGeoCode,
      memberGeoName: r.memberGeoName,
      memberGeoLevel: r.memberGeoLevel,
      matchMethod: r.matchMethod,
      sourceKind: r.sourceKind,
      sourceRef: r.sourceRef,
      retrievedAt: r.retrievedAt,
    });
  }

  const aboutSheet = workbook.addWorksheet("About this data");
  const aboutRows: [string, string][] = [
    ["Source", "Wikipedia/Wikidata, per-row provenance in the Mapping sheet"],
    ["License", "CC BY 4.0"],
    ["Retrieved", new Date().toISOString()],
    [
      "Status",
      "Derived, community-correctable mapping — not published by PSA or COMELEC. See /districts for the correction ledger and known gaps.",
    ],
  ];
  for (const [label, value] of aboutRows) {
    const row = aboutSheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  aboutSheet.columns = [{ width: 14 }, { width: 90 }];

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="bhw-connect-legislative-districts-mapping.xlsx"',
    },
  });
}
