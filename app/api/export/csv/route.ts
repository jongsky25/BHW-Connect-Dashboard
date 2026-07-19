import { NextResponse } from "next/server";
import { getExportFigureData } from "@/lib/exports/figure-data";
import { parseExportQuery, slugify } from "@/lib/exports/query";

export const runtime = "nodejs";

/** CSV export: aggregate rows + a header comment block (title, filters, source, license, retrieval time). */
export async function GET(request: Request) {
  const parsed = parseExportQuery(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }

  const data = await getExportFigureData(parsed.data);
  if (!data) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const retrieved = new Date().toISOString();
  const lines = [
    `# ${data.title} - ${data.geoName}`,
    `# ${data.caption}`,
    `# Source: ${data.sourceName}`,
    `# License: ${data.license}`,
    `# Retrieved: ${retrieved}`,
    "#",
    `label,value${data.valueSuffix ? ` (${data.valueSuffix})` : ""}`,
  ];

  if (data.isSuppressed) {
    lines.push("suppressed to protect privacy (n<5),");
  } else if (data.rows.length === 0) {
    lines.push("no data,");
  } else {
    for (const row of data.rows) {
      lines.push(`"${row.label.replace(/"/g, '""')}",${row.value}`);
    }
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(data.title, data.geoName)}.csv"`,
    },
  });
}
