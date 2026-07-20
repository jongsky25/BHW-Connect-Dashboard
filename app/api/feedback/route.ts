import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { Json } from "@/lib/db/database.types";

export const runtime = "nodejs";

const SCREENSHOT_BUCKET = "feedback-screenshots";
// ~4MB base64 ceiling — a downscaled JPEG viewport shot is well under this; anything larger is
// rejected rather than uploaded.
const MAX_SCREENSHOT_CHARS = 4 * 1024 * 1024;

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  pagePath: z.string().max(300),
  category: z.enum(["bug", "data_question", "suggestion", "other"]),
  message: z.string().min(1).max(2000),
  email: z.string().email().max(200).optional().or(z.literal("")),
  // Honeypot: real users never see or fill this field (BUILD_PLAN.md §7 1.9 "rate-limited,
  // honeypot") — must accept *any* string so a bot's filled-in value still passes validation
  // and reaches the runtime check below, rather than bouncing off a 400 that tips it off.
  website: z.string().max(500).optional(),
  // Spot-feedback fields (all optional — the plain /feedback form omits them).
  pageUrl: z.string().max(2000).optional(),
  selector: z.string().max(1000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  screenshot: z.string().max(MAX_SCREENSHOT_CHARS).optional(),
});

/** Decode a `data:image/...;base64,...` URL into bytes + content type, or null if malformed. */
function decodeDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } | null {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { contentType: match[1], bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

/** Upload a screenshot to the private bucket via the service-role client; null on any failure so a
 * bad/oversized image never blocks the feedback itself. */
async function uploadScreenshot(sessionId: string, dataUrl: string): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const ext = decoded.contentType === "image/png" ? "png" : "jpg";
  const path = `${sessionId}/${crypto.randomUUID()}.${ext}`;
  try {
    const service = createSupabaseServiceClient();
    const { error } = await service.storage
      .from(SCREENSHOT_BUCKET)
      .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: false });
    return error ? null : path;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
  }

  if (parsed.data.website) {
    // Honeypot tripped — pretend success so a bot doesn't learn to adapt.
    return NextResponse.json({ ok: true });
  }

  const { data } = parsed;
  const screenshotPath = data.screenshot
    ? await uploadScreenshot(data.sessionId, data.screenshot)
    : null;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("feedback").insert({
    session_id: data.sessionId,
    page_path: data.pagePath,
    category: data.category,
    message: data.message,
    email: data.email || null,
    page_url: data.pageUrl ?? null,
    target_selector: data.selector ?? null,
    context: (data.context ?? null) as Json,
    screenshot_path: screenshotPath,
  });

  if (error) {
    return NextResponse.json({ error: "Could not submit feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
