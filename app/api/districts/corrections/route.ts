import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

// D2.3 — structured, not free text (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5): a proposal has to be
// diffable against the current mapping and applyable without re-interpretation. Reuses the
// `feedback` route's defences verbatim: honeypot field, session id, the 2,000-char cap, and an
// optional email that is never published.
const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    action: z.enum(["add", "remove", "move", "rename", "other"]),
    districtCode: z.string().min(1).max(50),
    toDistrictCode: z.string().max(50).optional().or(z.literal("")),
    geoCode: z.string().max(20).optional().or(z.literal("")),
    rationale: z.string().min(1).max(2000),
    evidenceUrl: z.string().url().max(500).optional().or(z.literal("")),
    email: z.string().email().max(200).optional().or(z.literal("")),
    // Honeypot: must accept *any* string so a bot's filled-in value still passes validation and
    // reaches the runtime check below, rather than bouncing off a 400 that tips it off.
    website: z.string().max(500).optional(),
  })
  .refine((data) => data.action !== "move" || data.toDistrictCode, {
    message: "A move needs a destination district",
    path: ["toDistrictCode"],
  })
  .refine((data) => !["add", "remove", "move"].includes(data.action) || data.geoCode, {
    message: "Which city, municipality, or barangay this is about",
    path: ["geoCode"],
  });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid correction" }, { status: 400 });
  }

  if (parsed.data.website) {
    // Honeypot tripped — pretend success so a bot doesn't learn to adapt.
    return NextResponse.json({ ok: true });
  }

  const { data } = parsed;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("district_correction").insert({
    session_id: data.sessionId,
    action: data.action,
    district_code: data.districtCode,
    to_district_code: data.toDistrictCode || null,
    geo_code: data.geoCode || null,
    rationale: data.rationale,
    evidence_url: data.evidenceUrl || null,
    submitter_email: data.email || null,
  });

  if (error) {
    return NextResponse.json({ error: "Could not submit correction" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
