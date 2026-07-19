import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

// Flat and JSON-primitive-only — keeps `meta` bounded (BUILD_PLAN.md §4.1) rather than
// accepting arbitrary nested payloads.
const bodySchema = z.object({
  sessionId: z.string().uuid(),
  eventType: z.string().min(1).max(64),
  pagePath: z.string().max(300).optional(),
  geoCode: z.string().max(20).optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

/** Salted + truncated — never store or log a raw IP address (BUILD_PLAN.md §5 privacy engineering). */
function hashIp(ip: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/** Usage-event ingest — public INSERT only, no SELECT, per the RLS policy verified in 0.3. */
export async function POST(request: Request) {
  if (request.headers.get("dnt") === "1") {
    return NextResponse.json({ ok: true, skipped: "dnt" });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const salt = process.env.USAGE_EVENTS_IP_SALT;
  const ip = clientIp(request);
  const ipHash = salt && ip ? hashIp(ip, salt) : null;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("usage_events").insert({
    session_id: parsed.data.sessionId,
    event_type: parsed.data.eventType,
    page_path: parsed.data.pagePath ?? null,
    geo_code: parsed.data.geoCode ?? null,
    meta: parsed.data.meta ?? null,
    ip_hash: ipHash,
  });

  if (error) {
    return NextResponse.json({ error: "Could not log event" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
