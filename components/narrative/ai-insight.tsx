import { Suspense } from "react";
import Link from "next/link";
import { getOrGenerateNarrative } from "@/lib/ai/narrative";
import type { GeoLevel } from "@/lib/filters/schema";
import { GlossaryTerm } from "@/components/glossary/glossary-term";

type AiInsightProps = { geoCode: string; geoLevel: GeoLevel; geoName: string };

function AiInsightSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-background p-4 sm:p-6" aria-hidden>
      <div className="h-3 w-40 rounded bg-surface" />
      <div className="mt-3 h-4 w-full rounded bg-surface" />
      <div className="mt-2 h-4 w-5/6 rounded bg-surface" />
    </div>
  );
}

async function AiInsightContent({ geoCode, geoLevel, geoName }: AiInsightProps) {
  const narrative = await getOrGenerateNarrative(geoCode, geoLevel, geoName);
  // No AI generation available and nothing cached (e.g. every provider capped on a cold cache) —
  // the page's existing template headlines already cover this figure, so render nothing extra
  // rather than an empty/broken-looking card (BUILD_PLAN.md §4.5: never an error state).
  if (!narrative) return null;

  return (
    <section aria-label="AI-generated insight" className="rounded-lg border border-border bg-background p-4 sm:p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        <GlossaryTerm slug="ai_generated">AI-generated</GlossaryTerm> insight
      </p>
      <p className="mt-2 text-sm">{narrative.content}</p>
      <p className="mt-2 text-xs text-muted">
        Written from the same figures shown on this page — see{" "}
        <Link href="/methodology#ai" className="underline hover:text-accent">
          how this works
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * The Phase 2 AI narrative slot (BUILD_PLAN.md §8 2.3): behind Suspense so a slow or all-capped
 * AI call never blocks the rest of a server-rendered page — the surrounding template headlines
 * (Phase 1, still present on every figure) mean the page is already fully useful without this.
 */
export function AiInsight(props: AiInsightProps) {
  return (
    <Suspense fallback={<AiInsightSkeleton />}>
      <AiInsightContent {...props} />
    </Suspense>
  );
}
