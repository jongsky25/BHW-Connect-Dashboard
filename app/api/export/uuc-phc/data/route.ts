import { NextResponse } from "next/server";
import { z } from "zod";
import { geoLevelSchema } from "@/lib/filters/schema";
import { DATASET_SLUGS, getDatasetBySlug } from "@/lib/db/dataset";
import { getGeoByCode } from "@/lib/db/geo";
import { getUucPhcCounts } from "@/lib/db/uuc-phc";
import { getUucPhcListRows, isExportableLevel } from "@/lib/db/uuc-phc-list";
import {
  renderUucPhcCsv,
  renderUucPhcXlsx,
  uucPhcExportFilename,
  type UucPhcExportMeta,
} from "@/lib/exports/uuc-phc-data";

export const runtime = "nodejs";

/**
 * The 2025 UUC for PHC list as rows, for a chosen area (plan U11).
 *
 * **Its own contract, deliberately not `/api/export/csv`'s.** `parseExportQuery`
 * (`lib/exports/query.ts`) is keyed to the BHW `indicatorSchema` — every one of its shapes is a
 * label/value pair from a BHW aggregate — and this is 41 columns of a membership list. Widening
 * that schema to admit a dataset it was not built for would put two unrelated contracts behind one
 * parser; `geoLevel` / `geoCode` / `format` is the whole of this one.
 *
 * **This is the export U4 refused to build, in the format that makes it publishable.** The PNG
 * one-pager carries no indicator values because a picture cannot carry the † marker a bounded value
 * needs. A spreadsheet can: `capped_indicators` is a column, and the notes block above the data
 * says what a named value means. Same rule, a format that satisfies it.
 */
const querySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
  // CSV is the default because it is the format that opens anywhere; XLSX is what carries the
  // notes block as a readable paragraph and shades the bounded values in place.
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
    format: searchParams.get("format") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export parameters" }, { status: 400 });
  }
  const { geoCode, geoLevel, format } = parsed.data;

  // The section publishes nothing at barangay grain — `/uuc-phc/barangay/*` 404s, because a
  // barangay's answer is a single yes/no. A one-row export would be that same non-answer.
  if (!isExportableLevel(geoLevel)) {
    return NextResponse.json(
      { error: "This list is exported at national, region, province or city/municipality level" },
      { status: 400 },
    );
  }

  const [geo, counts, dataset, rows] = await Promise.all([
    getGeoByCode(geoCode),
    getUucPhcCounts(geoCode, geoLevel),
    getDatasetBySlug(DATASET_SLUGS.uucPhc),
    getUucPhcListRows(geoCode, geoLevel),
  ]);

  // No counts row means no such area (or a failed read of the aggregate) — the same 404 the PNG
  // export gives. An area with *nothing listed* is a different thing entirely: it has a row
  // reading 0, and it gets a real file with its notes and its header and no data rows, because
  // "0 of 1,675 barangays in NCR" is a finding rather than a missing export.
  if (!counts) {
    return NextResponse.json({ error: "No UUC for PHC data for this area" }, { status: 404 });
  }
  if (!rows) {
    return NextResponse.json({ error: "Could not read the list right now" }, { status: 503 });
  }

  // **Refuse to emit a short file.** The fact loader already refuses to emit on a failed row-count
  // check, on the reasoning that a silently short load is worse than a failed one when 5,991 is a
  // headline figure — and a spreadsheet is the case where that matters most, because it leaves the
  // building and nothing downstream will ever notice a province went missing. `n_listed` is
  // computed from a different fact table than these rows are, so the two agreeing is a real check.
  if (rows.length !== counts.nListed) {
    return NextResponse.json(
      { error: "The export did not match this area's listed count and was not sent" },
      { status: 500 },
    );
  }

  const meta: UucPhcExportMeta = {
    geoCode,
    geoLevel,
    geoName: geo?.geoName ?? geoCode,
    nListed: counts.nListed,
    nBarangays: counts.nBarangays,
    sourceName: dataset?.sourceName ?? null,
    license: dataset?.license ?? null,
    asOfDate: dataset?.asOfDate ?? null,
    retrievedAt: new Date().toISOString(),
  };
  const filename = uucPhcExportFilename(meta, format);

  if (format === "xlsx") {
    const buffer = await renderUucPhcXlsx(rows, meta);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(renderUucPhcCsv(rows, meta), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
