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
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Coming next (Phase 2)</h2>
        <ul className="list-inside list-disc">
          <li>Strictly data-grounded AI narratives and an &quot;ask the data&quot; chat, with every number traceable back to the same figures shown on screen</li>
          <li>Barangay-level map polygons</li>
          <li>An admin panel for feedback triage, usage dashboards, and content curation</li>
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
          .
        </p>
      </section>
    </div>
  );
}
