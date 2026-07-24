import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How the 2026 BHW Profiling Status is measured — the Encode → Validate → Attest pipeline, the four mutually-exclusive stages, the denominator, and the data source.",
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
          <em>validated</em> → <em>approved</em>. We group these into four{" "}
          <strong>mutually-exclusive stages</strong> — every BHW to be profiled sits in exactly one,
          so the four shares always add up to 100% of the total:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-muted">
          <li>
            <strong>Encoded</strong> — in the pipeline but not yet validated (drafted, for
            validation, or back to the encoder for rework).
          </li>
          <li>
            <strong>Validated</strong> — validated, but not yet attested.
          </li>
          <li>
            <strong>Attested</strong> — approved. This is the finish line (formerly labelled
            &ldquo;Certified&rdquo;).
          </li>
          <li>
            <strong>Not yet encoded</strong> — BHWs in the headcount who have not entered the
            pipeline at all.
          </li>
        </ul>
        <p className="text-muted">
          Because the stages are mutually exclusive rather than cumulative, Encoded + Validated +
          Attested + Not-yet-encoded = 100% of all BHWs to profile.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How far there is to go</h2>
        <p className="text-muted">
          The headline &ldquo;still to attest&rdquo; gap is the total to profile minus those already
          attested — everyone in the first three-plus-remaining stages who has not yet reached the
          finish line. When an encoding snapshot runs slightly ahead of the headcount, this gap is
          floored at zero (there is nothing left to do, not a negative gap).
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Where encoded records sit</h2>
        <p className="text-muted">
          The single &ldquo;Encoded&rdquo; stage can hide <em>where</em> work is stuck, so we break
          it into the states it is made of — drafted (not yet submitted), awaiting validation, and
          sent back to the encoder for rework. Records sent back to the encoder are a rework/quality
          signal worth watching.
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
