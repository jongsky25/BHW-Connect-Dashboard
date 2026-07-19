import { NextResponse } from "next/server";
import { getOrGenerateNarrative } from "@/lib/ai/narrative";
import { getAllGeosAtLevels, getGeoByCode } from "@/lib/db/geo";
import { getTopVisitedGeos } from "@/lib/db/usage-analytics";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
const TOP_VISITED_LIMIT = 20;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // refuse to run unauthenticated even if the secret is unset
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type Target = { geoCode: string; geoLevel: GeoLevel; geoName: string };

/**
 * Daily precompute (BUILD_PLAN.md §8 2.3): national + every region + every province + the most-
 * visited other places, so most visitors hit a cached AI insight instead of triggering a live
 * generation. One invocation, not two, per Vercel Hobby's cron-job-count limit (pitfall P6) — the
 * narrative lookups already read `dim_dataset` on every call, which doubles as the Supabase
 * keep-alive ping (pitfall P5), so no separate ping step is needed.
 *
 * Free-tier request/minute caps (2.1) mean a single run can't realistically regenerate all ~137
 * targets from cold — `ranOutOfTime`/`remainingAfterTimeout` in the response make that explicit
 * rather than silently under-covering. Already-cached targets are cheap (one cache-hit read each),
 * so coverage fills in over a few days as new targets get generated and then stay cached.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const [regionsAndProvinces, topVisited] = await Promise.all([
    getAllGeosAtLevels(["region", "province"]),
    getTopVisitedGeos(TOP_VISITED_LIMIT),
  ]);

  const targets: Target[] = [
    { geoCode: NATIONAL_GEO_CODE, geoLevel: "national", geoName: "Philippines" },
    ...regionsAndProvinces.map((g) => ({ geoCode: g.geoCode, geoLevel: g.geoLevel, geoName: g.geoName })),
  ];

  const knownCodes = new Set(targets.map((t) => t.geoCode));
  for (const visited of topVisited) {
    if (knownCodes.has(visited.geoCode)) continue;
    const geo = await getGeoByCode(visited.geoCode);
    if (!geo) continue;
    targets.push({ geoCode: geo.geoCode, geoLevel: geo.geoLevel, geoName: geo.geoName });
    knownCodes.add(geo.geoCode);
  }

  let attempted = 0;
  let generated = 0;
  let ranOutOfTime = false;

  for (const target of targets) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }
    attempted++;
    const result = await getOrGenerateNarrative(target.geoCode, target.geoLevel, target.geoName);
    if (result && !result.cached) generated++;
  }

  return NextResponse.json({
    totalTargets: targets.length,
    attempted,
    generated,
    ranOutOfTime,
    remainingAfterTimeout: ranOutOfTime ? targets.length - attempted : 0,
    durationMs: Date.now() - started,
  });
}
