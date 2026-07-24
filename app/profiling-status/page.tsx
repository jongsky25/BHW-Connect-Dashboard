import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";
import { GeoSearch } from "@/components/home/geo-search";
import { StatusHero } from "@/components/profiling-status/status-hero";
import { FunnelBars } from "@/components/profiling-status/funnel-bars";
import { BottleneckBars } from "@/components/profiling-status/bottleneck-bars";
import { AreaRanking } from "@/components/profiling-status/area-ranking";
import { CoverageFlags } from "@/components/profiling-status/coverage-flags";
import { ChildBreakdown } from "@/components/profiling-status/child-breakdown";

// 1 hour, not 24. This page is statically prerendered, so whatever it renders is cached for the
// whole window — including the "data is not available" empty state, which `getProfilingStatus`
// returns on *any* read miss (a genuinely-absent row OR a transient Supabase error; see
// lib/db/profiling-status.ts `if (error || !data) return null`). A 24h window meant a single
// transient miss during (re)generation froze the landing page as empty for a full day even though
// the data was present and readable. An hourly window bounds that blast radius; the underlying
// dataset only changes on the daily ingestion cron, so nothing is lost by refreshing more often.
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: { absolute: "BHW Profiling Status 2026 · Overview" },
  description:
    "Nationwide progress of the 2026 Barangay Health Worker individual-profiling exercise: how many BHWs have been encoded, validated, and attested.",
};

export default async function ProfilingStatusLanding() {
  const [status, children] = await Promise.all([
    getProfilingStatus(NATIONAL_GEO_CODE, "national"),
    getProfilingStatusChildren(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!status) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">BHW Profiling Status 2026</h1>
        <p className="text-muted">Profiling-status data is not available right now.</p>
      </div>
    );
  }

  const regionCount = children.length;
  const downloadHref = "/api/export/profiling-status?geoLevel=national&geoCode=PH";

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          How far along is 2026 BHW profiling?
        </h1>
        <p className="max-w-2xl text-muted">
          Every Barangay Health Worker is being individually profiled this year, moving through the
          pipeline <strong>Encode → Validate → Attest</strong>. Every BHW sits in exactly one stage —
          encoded, validated, attested, or not yet encoded — so the four shares below add up to 100%
          of all BHWs to profile.
        </p>
        <div className="max-w-md">
          <GeoSearch mode="profiling" />
        </div>
      </section>

      {/* National funnel */}
      <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StatusHero status={status} />
          <h2 className="text-lg font-semibold tracking-tight text-muted">Philippines</h2>
        </div>
        <div className="mt-6">
          <FunnelBars status={status} />
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <BottleneckBars status={status} />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted">Encode → Validate → Attest · 2026 profiling</p>
          <a
            href={downloadHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
          >
            Download summary (PNG)
          </a>
        </div>
      </section>

      {/* Region ranking (renders only when there's real spread to show) */}
      <AreaRanking heading="Regions" items={children} />

      {/* Region breakdown */}
      <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
        <ChildBreakdown heading="Regions" items={children} />
        <div className="mt-4 border-t border-border pt-4">
          <CoverageFlags items={children} />
        </div>
        {regionCount > 0 && (
          <p className="mt-3 text-xs text-muted">
            Covering {regionCount} region{regionCount === 1 ? "" : "s"} of the Philippines. Drill
            into any region for its provinces and city/municipalities.
          </p>
        )}
      </div>

      <p className="text-sm text-muted">
        See the{" "}
        <Link href="/profiling-status/methodology" className="underline hover:text-accent">
          methodology
        </Link>{" "}
        for how the pipeline steps and denominator are defined. This dataset is separate from the{" "}
        <Link href="/bhw" className="underline hover:text-accent">
          2025 BHW Census
        </Link>
        .
      </p>
    </div>
  );
}
