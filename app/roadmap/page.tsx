export const metadata = { title: "Roadmap" };

export default function RoadmapPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roadmap</h1>
        <p className="mt-2 text-muted">What&apos;s live today, what&apos;s coming next, and how to suggest what we cover after that.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Live now</h2>
        <ul className="list-inside list-disc">
          <li>National, regional, provincial, city/municipality, and barangay figures on accreditation, demographics, training, and honorarium</li>
          <li>Cascading explore dashboard with a live choropleth map (down to city/municipality level)</li>
          <li>Shareable place profile pages for every region, province, city/municipality, and barangay</li>
          <li>Compare mode for side-by-side places</li>
          <li>CSV, XLSX, PNG, and PPTX exports for every figure</li>
          <li>Full methodology, glossary, and data-quality pages</li>
          <li>
            Strictly data-grounded AI insights and an &quot;ask the data&quot; chat — every number is
            looked up live and checked before it&apos;s shown; see{" "}
            <a href="/methodology#ai" className="underline hover:text-accent">
              how this works
            </a>
          </li>
          <li>An admin panel for feedback triage, usage dashboards, and content curation (staff-only)</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Coming next</h2>
        <ul className="list-inside list-disc">
          <li>Barangay-level map polygons</li>
          <li>
            A second dataset — population figures for per-capita context (&quot;BHWs per 1,000
            residents&quot;) is the leading candidate; see the scoping notes below
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Have a dataset to suggest?</h2>
        <p>
          BHW Connect is built as shared infrastructure for more than one Philippine public-interest
          dataset. If there&apos;s a dataset you think belongs here next, tell us via{" "}
          <a href="/feedback" className="underline hover:text-accent">
            feedback
          </a>
          . We keep a running assessment of candidates — license, geographic join, how often it
          updates — in{" "}
          <a
            href="https://github.com/jongsky25/bhw-connect-dashboard/blob/main/docs/DATASET_SCOPING.md"
            className="underline hover:text-accent"
            target="_blank"
            rel="noopener noreferrer"
          >
            our dataset scoping notes
          </a>
          .
        </p>
      </section>
    </div>
  );
}
