import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getProfilingStatus, getProfilingStatusChildren } from "@/lib/db/profiling-status";
import {
  ProfilingStatusPanel,
  type ProfilingStatusView,
} from "./profiling-status-panel";

/**
 * Public "BHW Connect Profiling Status (2026)" card for `/bhw`. Shows, at a glance, how far
 * the 2026 individual-profiling encoding has progressed nationally through Encode → Validate
 * → Certify, with a level drill-down (region → province → city/municipality) and a one-page
 * PNG download. Reads the standalone 2026 dataset — deliberately separate from the 2025 BHW
 * figures above it. Renders nothing if the dataset hasn't been loaded (graceful degrade).
 */
export async function ProfilingStatusCard() {
  const [status, children] = await Promise.all([
    getProfilingStatus(NATIONAL_GEO_CODE, "national"),
    getProfilingStatusChildren(NATIONAL_GEO_CODE, "national"),
  ]);

  if (!status) return null;

  const initial: ProfilingStatusView = {
    geoCode: NATIONAL_GEO_CODE,
    geoLevel: "national",
    geoName: "Philippines",
    status,
    children,
  };

  return (
    <section aria-labelledby="profiling-status-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="profiling-status-heading" className="text-xl font-semibold tracking-tight">
          BHW Profiling Status (2026)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Progress of the 2026 individual-profiling exercise — every registered, accredited and
          non-registered BHW moves through <strong>Encode → Validate → Certify</strong>. Percentages
          are of all BHWs to be profiled. Pick an area to see its progress. Separate from the 2025
          figures above.
        </p>
      </div>
      <ProfilingStatusPanel initial={initial} />
    </section>
  );
}
