import { NextResponse } from "next/server";
import { z } from "zod";
import { searchGeo } from "@/lib/db/search";

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ q: searchParams.get("q") ?? "" });

  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchGeo(parsed.data.q);
  return NextResponse.json({ results });
}
