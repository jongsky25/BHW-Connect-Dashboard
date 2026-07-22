import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How the 2026 BHW Profiling Status is measured — the Encode → Validate → Certify pipeline, the denominator, and the data source.",
};

export default function ProfilingStatusMethodology() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Methodology</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What this measures</h2>
        <p className="text-muted">
          The <strong>2026 BHW Profiling Status</strong> tracks how far the individual-profiling of
          Barangay Health Workers has progressed this year. It is a live operational snapshot of an
          encoding workflow — not a demographic census. It is a separate dataset from the{" "}
          <Link href="/bhw" className="underline hover:text-accent">
            2025 BHW Census
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The pipeline</h2>
        <p className="text-muted">
          Each BHW record moves through a sequence of statuses: <em>drafted</em> →{" "}
          <em>for validation</em> → (<em>back to encoder</em> if it needs rework) →{" "}
          <em>validated</em> → <em>approved</em>. We roll these into three cumulative steps:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-muted">
          <li>
            <strong>Encode</strong> — every record that has entered the pipeline (drafted, for
            validation, back to encoder, validated, or approved).
          </li>
          <li>
            <strong>Validate</strong> — records that have passed validation (validated + approved).
          </li>
          <li>
            <strong>Certify</strong> — records that have been approved.
          </li>
        </ul>
        <p className="text-muted">
          Because the steps are cumulative, Encoded ≥ Validated ≥ Certified always holds.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How far there is to go</h2>
        <p className="text-muted">
          Alongside each step&rsquo;s progress we show the <strong>remaining</strong> count — how
          many BHWs still have to reach it — and the headline &ldquo;still to certify&rdquo; gap,
          which is the total to profile minus those already certified. When an encoding snapshot
          runs slightly ahead of the headcount, the remaining figure is floored at zero (there is
          nothing left to do, not a negative gap).
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Where records sit now</h2>
        <p className="text-muted">
          The cumulative funnel hides <em>where</em> work is stuck, so we also break the same
          population into mutually-exclusive current states — drafted, awaiting validation, sent
          back for rework, validated but not yet certified, certified, and not yet encoded. Records
          sent back to the encoder are a rework/quality signal worth watching.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The denominator</h2>
        <p className="text-muted">
          Progress percentages are measured against <strong>all BHWs to be profiled</strong> —
          registered, accredited, and non-registered combined. The 2026 goal is to profile every
          BHW, so (unlike the 2025 census) non-registered BHWs are part of the base, not excluded
          from it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Geography &amp; coverage</h2>
        <p className="text-muted">
          Figures are reported for each city/municipality and rolled up to province, region, and
          national level. You can drill from the nation down to a region, a province, and a
          city/municipality. Coverage grows region by region as encoding data is loaded; areas
          without data yet show an explicit &ldquo;no data&rdquo; state rather than a zero.
        </p>
        <p className="text-muted">
          The 2026 encoding status is collected at the city/municipality level, so a
          barangay-by-barangay breakdown is not yet available; barangay pages say so explicitly and
          will populate if barangay-grain data is loaded. Because this is a single point-in-time
          snapshot, trends over time (velocity, projected completion) are not shown yet — they need
          repeated snapshots to compute.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Source &amp; privacy</h2>
        <p className="text-muted">
          Source: Department of Health (DOH) BHW Connect — 2026 individual-profiling encoding
          status. Only aggregate counts and percentages are shown or exported; no personal or
          individual-level records are published.
        </p>
      </section>

      <p>
        <Link href="/profiling-status" className="text-sm underline hover:text-accent">
          ← Back to overview
        </Link>
      </p>
    </div>
  );
}
