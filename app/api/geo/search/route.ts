import { NextResponse } from "next/server";
import { z } from "zod";
import { searchGeo } from "@/lib/db/search";
import { searchDistricts } from "@/lib/db/districts";

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

/**
 * D3.3 — "/api/geo/search: districts become searchable by name and by member LGU, so 'Palo'
 * surfaces 'Leyte's 1st'." Districts are a separate search (`search_district`, never mixed into
 * `dim_geo`/`agg_geo_summary` per guardrail 7 — a district is not a geo_level, plan §1), so this
 * route runs both and appends district hits after geo hits rather than trying to rank the two
 * against each other on one scale (geo's full-text matches are boosted +100 over its own
 * word-similarity matches — see `search_geo`'s migration comment — a scale district's plain
 * word-similarity score was never designed to compete with).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ q: searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const [geoResults, districtResults] = await Promise.all([
    searchGeo(parsed.data.q, 6),
    searchDistricts(parsed.data.q, 4),
  ]);

  const results = [
    ...geoResults.map((r) => ({ kind: "geo" as const, ...r })),
    ...districtResults.map((r) => ({ kind: "district" as const, ...r })),
  ];

  return NextResponse.json({ results });
}
