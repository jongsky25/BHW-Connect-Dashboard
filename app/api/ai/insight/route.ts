import { NextResponse } from "next/server";
import { z } from "zod";
import { getGeoByCode } from "@/lib/db/geo";
import { NATIONAL_GEO_CODE, geoLevelSchema } from "@/lib/filters/schema";
import { getOrGenerateNarrative } from "@/lib/ai/narrative";

export const runtime = "nodejs";

const querySchema = z.object({ geoCode: z.string().min(1).max(20), geoLevel: geoLevelSchema });

/**
 * AI narrative for one geography: cache lookup → live generate → write-back (BUILD_PLAN.md
 * §4.2 "api/ai/insight"). `components/narrative/ai-insight.tsx` calls `getOrGenerateNarrative`
 * directly as a Suspense-boundaried Server Component rather than fetching this route (no reason
 * to pay a self-HTTP round trip); this route exists as the standalone public API surface for the
 * same lookup — e.g. the precompute cron, or an external caller. Returns `{ content: null }` —
 * never a 5xx — when nothing grounded is available; callers render the Phase 1 template narrative
 * in that case.
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
