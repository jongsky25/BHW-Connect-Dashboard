import { getActiveDataset } from "@/lib/db/dataset";
import { getChangelogEntries } from "@/lib/db/changelog";
import { GlossaryTerm } from "@/components/glossary/glossary-term";

export const metadata = { title: "Methodology" };

export default async function MethodologyPage() {
  const [dataset, changelog] = await Promise.all([getActiveDataset(), getChangelogEntries()]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-2 text-muted">How the figures on BHW Connect are computed, and what they don&apos;t tell you.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Source</h2>
        <p>
          {dataset?.sourceName ??
            "An official DOH Barangay Health Worker registration/accreditation dataset"}
          , a {dataset?.asOfDate ?? "2025"} snapshot. All BHWs in the dataset are treated as active
          for that year; year-list fields (active/inactive service years) are parsed separately for
          service-history figures.
        </p>
        <p>
          Published aggregates and downloads are licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="underline hover:text-accent"
            rel="license noopener noreferrer"
            target="_blank"
          >
            {dataset?.license ?? "CC BY 4.0"}
          </a>
          .
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Geography</h2>
        <p>
          Places are identified by their <GlossaryTerm slug="psgc">PSGC</GlossaryTerm> code, padded
          to a fixed width at every level (region: 2 digits, province: 5, city/municipality: 7,
          barangay: 10). Maps are shown down to the city/municipality level; barangay-level figures
          are available via search and place pages, with barangay map polygons planned for a future
          release. Where a place has no matching boundary polygon (see{" "}
          <a href="/data-quality" className="underline hover:text-accent">
            data quality
          </a>
          ), it&apos;s shown in the ranked list next to the map rather than omitted.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Denominators</h2>
        <p>
          Unless stated otherwise, a percentage&apos;s denominator is the total BHW count for the
          selected place and (for demographic breakdowns) the selected characteristic. Every figure
          shows its exact N in the &quot;Technical details&quot; disclosure.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Privacy &amp; suppression</h2>
        <p>
          Individual-level breakdowns (sex, age, civil status, blood type, education, IP status)
          are <GlossaryTerm slug="suppressed">suppressed</GlossaryTerm> whenever a place has fewer
          than 5 BHWs, and roll up to the nearest larger place where showing the number is safe.
          Total BHW counts for a place are not suppressed.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Limitations</h2>
        <ul className="list-inside list-disc">
          <li>The dataset is a single snapshot, not a live registry — figures don&apos;t update in real time.</li>
          <li>Sex is heavily skewed female in the underlying data, which is why sex breakdowns hit suppression routinely at the barangay level.</li>
          <li>A handful of places have no matching map boundary due to source-data vintage differences — see /data-quality.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Changelog</h2>
        {changelog.length === 0 ? (
          <p className="text-muted">No changelog entries yet — this is the initial public release.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {changelog.map((entry) => (
              <li key={entry.id}>
                <p className="font-medium">{entry.title}</p>
                <p className="text-sm text-muted">{entry.bodyMd}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
