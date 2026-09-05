import { NextResponse } from "next/server";
import { getDistrictMappingExport } from "@/lib/db/districts";

export const runtime = "nodejs";

/**
 * D3.3 owner decision 3 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §0): "Publishing the mapping as a
 * download — yes, after D2 ships." One row per live membership — the mapping itself, not a
 * derived figure — with the same provenance columns `/districts/[districtCode]` already shows on
 * screen, so a downloaded copy carries the same receipt.
 */
export async function GET() {
  const rows = await getDistrictMappingExport();
  const retrieved = new Date().toISOString();

  const header = [
    "district_code",
    "district_name",
    "congress_no",
    "region",
    "member_geo_code",
    "member_geo_name",
    "member_geo_level",
    "match_method",
    "source_kind",
    "source_ref",
    "retrieved_at",
  ];

  function csvField(value: string | number): string {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const lines = [
    "# Philippine legislative district mapping — BHW Connect",
    "# Derived from public sources (Wikipedia/Wikidata), not published by PSA or COMELEC.",
    "# See /districts for the full transparency page, correction ledger, and known gaps.",
    "# License: CC BY 4.0",
    `# Retrieved: ${retrieved}`,
    "#",
    header.join(","),
    ...rows.map((r) =>
      [
        r.districtCode,
        r.districtName,
        r.congressNo,
        r.regionName ?? "",
        r.memberGeoCode,
        r.memberGeoName,
        r.memberGeoLevel,
        r.matchMethod,
        r.sourceKind,
        r.sourceRef,
        r.retrievedAt,
      ]
        .map(csvField)
        .join(","),
    ),
  ];

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bhw-connect-legislative-districts-mapping.csv"',
    },
  });
}
