import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/supabase";

export const runtime = "nodejs";

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
});

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

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("feedback").insert({
    session_id: parsed.data.sessionId,
    page_path: parsed.data.pagePath,
    category: parsed.data.category,
    message: parsed.data.message,
    email: parsed.data.email || null,
  });

  if (error) {
    return NextResponse.json({ error: "Could not submit feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
