import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/db/require-admin";
import { recordRegressionCase } from "@/lib/db/regression-cases";

export const runtime = "nodejs";

/**
 * "This is wrong" (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.4).
 *
 * Admin-gated on the route itself, for the reason Increment 1.4 documents: `proxy.ts` matches
 * `/admin/:path*` and never sees an `/api/*` request, so a route handler is reachable without ever
 * loading the page that links to it. `getAdminUser()` runs before the body is parsed — nothing
 * about the request can influence whether the gate opens.
 *
 * Deliberately NOT rate-limited alongside the assistant's own limit. That limit exists to protect
 * a shared provider quota; this endpoint calls no provider, and throttling the act of reporting a
 * bad answer would suppress exactly the signal §10 depends on to grow.
 */

const bodySchema = z.object({
  question: z.string().min(1).max(4000),
  conversation: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(60),
  answerGiven: z.string().min(1).max(20000),
  toolCalls: z
    .array(z.object({ name: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()) }))
    .max(40)
    .default([]),
  citations: z.array(z.unknown()).max(40).default([]),
  provider: z.string().max(40).nullable().default(null),
  // Optional on purpose: a reader who knows an answer is wrong but not what the right one is
  // should still be able to say so. A case with no expected answer is still worth re-running.
  note: z.string().max(4000).nullable().default(null),
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const caseId = await recordRegressionCase({
    ...parsed.data,
    note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
    reportedBy: admin.id,
  });

  if (caseId === null) {
    // The report is lost, and saying so plainly is the honest outcome: a reader who is told
    // "recorded" when nothing was written will not report it again.
    return NextResponse.json({ error: "Could not record that — nothing was saved." }, { status: 503 });
  }

  return NextResponse.json({ caseId });
}
