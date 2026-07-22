import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { formatBenchmarkLine, getExportFigureData } from "@/lib/exports/figure-data";
import { parseExportQuery, slugify } from "@/lib/exports/query";

export const runtime = "nodejs";

/** XLSX export: styled title row + data sheet, plus a separate "About this data" sheet (§4.4). */
export async function GET(request: Request) {
  const parsed = parseExportQuery(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  const data = await getExportFigureData(parsed.data);
  if (!data) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BHW Connect";
  workbook.created = new Date();

  const dataSheet = workbook.addWorksheet("Data");
  dataSheet.mergeCells("A1:B1");
  const titleCell = dataSheet.getCell("A1");
  titleCell.value = `${data.title} — ${data.geoName}`;
  titleCell.font = { bold: true, size: 14 };

  dataSheet.mergeCells("A2:B2");
  dataSheet.getCell("A2").value = data.caption;
  dataSheet.getCell("A2").font = { italic: true, color: { argb: "FF57616A" } };

  const headerRow = dataSheet.addRow(["Label", data.valueSuffix ? `Value (${data.valueSuffix})` : "Value"]);
  headerRow.font = { bold: true };

  if (data.isSuppressed) {
    dataSheet.addRow(["Suppressed to protect privacy (n<5)", null]);
  } else if (data.rows.length === 0) {
    dataSheet.addRow(["No data available", null]);
  } else {
    for (const row of data.rows) dataSheet.addRow([row.label, row.value]);
  }
  dataSheet.columns = [{ width: 36 }, { width: 18 }];

  const aboutSheet = workbook.addWorksheet("About this data");
  const aboutRows: [string, string][] = [
    ["Source", data.sourceName],
    ["License", data.license],
    ["As of", data.asOfDate ?? "—"],
    ["Retrieved", new Date().toISOString()],
    ["Methodology", "See /methodology on the BHW Connect site for full definitions and denominators."],
    [
      "Suppression",
      "Individual-level breakdowns are suppressed when a geo has fewer than 5 BHWs, to prevent re-identification. Totals/counts are not suppressed.",
    ],
  ];
  // "No naked numbers" rows (Increment 5) — same benchmark line, peer-rank
  // sentence, and adequacy note the on-screen FigureBenchmark slot renders,
  // appended to the "About this data" sheet; each is omitted when absent.
  if (data.benchmark && data.benchmark.rows.some((r) => r.value !== null)) {
    aboutRows.push(["Benchmark", formatBenchmarkLine(data.benchmark)]);
  }
  if (data.benchmark?.peerLine) {
    aboutRows.push(["Peer rank", data.benchmark.peerLine]);
  }
  if (data.adequacyNote) {
    aboutRows.push(["Adequacy", data.adequacyNote]);
  }

  for (const [label, value] of aboutRows) {
    const row = aboutSheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  aboutSheet.columns = [{ width: 18 }, { width: 80 }];

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slugify(data.title, data.geoName)}.xlsx"`,
    },
  });
}
