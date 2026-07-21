import { NextResponse } from "next/server";
import { formatBenchmarkLine, getExportFigureData } from "@/lib/exports/figure-data";
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
  // "No naked numbers" header comments (Increment 5) — same benchmark line,
  // peer-rank sentence, and adequacy note the on-screen FigureBenchmark slot
  // renders, as extra `#`-prefixed comment lines; each is omitted when absent
  // rather than printed empty.
  const benchmarkComment =
    data.benchmark && data.benchmark.rows.some((r) => r.value !== null)
      ? `# Benchmark: ${formatBenchmarkLine(data.benchmark)}`
      : null;
  const peerComment = data.benchmark?.peerLine ? `# Peer rank: ${data.benchmark.peerLine}` : null;
  const adequacyComment = data.adequacyNote ? `# Adequacy: ${data.adequacyNote}` : null;

  const lines = [
    `# ${data.title} - ${data.geoName}`,
    `# ${data.caption}`,
    `# Source: ${data.sourceName}`,
    `# License: ${data.license}`,
    `# Retrieved: ${retrieved}`,
    ...([benchmarkComment, peerComment, adequacyComment].filter((s): s is string => Boolean(s))),
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
