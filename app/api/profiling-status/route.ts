import { NextResponse } from "next/server";
import { z } from "zod";
import { geoLevelSchema } from "@/lib/filters/schema";
import { getGeoByCode } from "@/lib/db/geo";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";

export const runtime = "nodejs";

const querySchema = z.object({
  geoCode: z.string().min(1),
  geoLevel: geoLevelSchema,
});

/**
 * Public read endpoint powering the BHW Profiling Status card's level drill-down: returns
 * the selected geo's Encode → Validate → Certify funnel plus its child units (which double
 * as the next drill-down level and the on-card breakdown). Aggregate-only, no personal data.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    geoCode: searchParams.get("geoCode"),
    geoLevel: searchParams.get("geoLevel"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const { geoCode, geoLevel } = parsed.data;
  const [geo, status, children] = await Promise.all([
    getGeoByCode(geoCode),
    getProfilingStatus(geoCode, geoLevel),
    getProfilingStatusChildren(geoCode, geoLevel),
  ]);

  if (!status) {
    return NextResponse.json({ error: "No profiling status for this area" }, { status: 404 });
  }

  return NextResponse.json({
    geoCode,
    geoLevel,
    geoName: geo?.geoName ?? geoCode,
    status,
    children,
  });
}
