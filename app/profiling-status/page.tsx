import type { Metadata } from "next";
import Link from "next/link";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";
import { formatCount } from "@/lib/format";
import { GeoSearch } from "@/components/home/geo-search";
import { FunnelBars } from "@/components/profiling-status/funnel-bars";
import { ChildBreakdown } from "@/components/profiling-status/child-breakdown";

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: { absolute: "BHW Profiling Status 2026 · Overview" },
  description:
    "Nationwide progress of the 2026 Barangay Health Worker individual-profiling exercise: how many BHWs have been encoded, validated, and certified.",
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

  const coverage = children.map((c) => c.geoName).join(", ");
  const downloadHref = "/api/export/profiling-status?geoLevel=national&geoCode=PH";

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          How far along is 2026 BHW profiling?
        </h1>
        <p className="max-w-2xl text-muted">
          Every Barangay Health Worker is being individually profiled this year. Each record moves
          through a three-step pipeline — <strong>Encode → Validate → Certify</strong>. Progress
          below is measured against all BHWs to be profiled.
        </p>
        <div className="max-w-md">
          <GeoSearch mode="profiling" />
        </div>
      </section>

      {/* National funnel */}
      <section className="rounded-lg border border-border bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Philippines</h2>
          <p className="text-sm text-muted">{formatCount(status.totalBhw)} BHWs to profile</p>
        </div>
        <div className="mt-4">
          <FunnelBars status={status} />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted">Encode → Validate → Certify · 2026 profiling</p>
          <a
            href={downloadHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
          >
            Download summary (PNG)
          </a>
        </div>
      </section>

      {/* Region breakdown */}
      <div className="rounded-lg border border-border bg-background p-5 sm:p-6">
        <ChildBreakdown heading="Regions" items={children} />
        {coverage && (
          <p className="mt-4 text-xs text-muted">
            Coverage so far: {coverage}. More regions are added as their encoding data is loaded.
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
