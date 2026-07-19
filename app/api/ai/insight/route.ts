import { NextResponse } from "next/server";
import { z } from "zod";
import { getGeoByCode } from "@/lib/db/geo";
import { NATIONAL_GEO_CODE, geoLevelSchema } from "@/lib/filters/schema";
import { getOrGenerateNarrative } from "@/lib/ai/narrative";

export const runtime = "nodejs";

const querySchema = z.object({ geoCode: z.string().min(1).max(20), geoLevel: geoLevelSchema });

/**
 * AI narrative for one geography: cache lookup → live generate → write-back (BUILD_PLAN.md
 * §4.2 "api/ai/insight"). Used by components/narrative/ai-insight.tsx (a client-fetched, Suspense-
 * boundaried card) so a slow/all-capped AI call never blocks the rest of a server-rendered page.
 * Returns `{ content: null }` — never a 5xx — when nothing grounded is available; callers render
 * the existing Phase 1 template narrative in that case.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    geoCode: url.searchParams.get("geoCode") ?? "",
    geoLevel: url.searchParams.get("geoLevel") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid geoCode/geoLevel" }, { status: 400 });
  }

  const { geoCode, geoLevel } = parsed.data;
  const geo =
    geoCode === NATIONAL_GEO_CODE
      ? { geoCode: NATIONAL_GEO_CODE, geoLevel: "national" as const, geoName: "Philippines" }
      : await getGeoByCode(geoCode);
  if (!geo || geo.geoLevel !== geoLevel) {
    return NextResponse.json({ error: "Unknown geo" }, { status: 404 });
  }

  const narrative = await getOrGenerateNarrative(geoCode, geoLevel, geo.geoName);
  return NextResponse.json({ content: narrative?.content ?? null, cached: narrative?.cached ?? false });
}
