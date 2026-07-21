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
        <h2 className="text-lg font-semibold">Two data sources: total vs. validated profiles</h2>
        <p>
          BHW Connect draws on two complementary datasets that measure different things:
        </p>
        <ul className="list-inside list-disc">
          <li>
            The <GlossaryTerm slug="stepzero">StepZero quick-count</GlossaryTerm> — a DOH
            barangay-level aggregate headcount — gives the{" "}
            <GlossaryTerm slug="total_bhw">total number of BHWs</GlossaryTerm>: about{" "}
            <strong>306,835</strong> nationally, split into{" "}
            <GlossaryTerm slug="registered_bhw">registered</GlossaryTerm> and registered &amp;
            accredited BHWs (<strong>278,240</strong> together) plus{" "}
            <GlossaryTerm slug="non_registered_bhw">non-registered</GlossaryTerm> BHWs
            (<strong>28,595</strong>). It also carries population and household context per barangay.
          </li>
          <li>
            The detailed per-person dataset holds{" "}
            <GlossaryTerm slug="validated_profile">validated profiles</GlossaryTerm> — about{" "}
            <strong>270,917</strong> individually profiled, anonymized BHW records. Every per-person
            figure on this site (accreditation, demographics, training, honorarium, service years) is
            computed from these validated profiles.
          </li>
        </ul>
        <p>
          <GlossaryTerm slug="profiling_coverage">Profiling coverage</GlossaryTerm> is the share of
          registered BHWs with a validated profile — nationally about{" "}
          <strong>97%</strong> (270,917 of 278,240). Non-registered BHWs are excluded from this
          ratio because they are not individually profiled, though they are still counted in the
          total.
        </p>
        <p className="text-sm text-muted">
          Both datasets come from the same 2025 BHW profiling initiative, not separate exercises:
          StepZero is the LGU-reported headcount collected first — local government units were
          asked how many BHWs they had before individual profiling began, so that denominators
          would be clear going in. The validated-profiles dataset is the result of that individual
          profiling. A small number of places (mostly whole cities/municipalities, plus individual
          barangays elsewhere) appear in StepZero&apos;s total but have no validated profiles yet —
          this reflects where individual profiling was still incomplete as of the 2025 snapshot,
          not a data error.
        </p>
        <p className="text-sm text-muted">
          Note on the official figure: DOH cites approximately <strong>277,767</strong> registered
          &amp; accredited BHWs. The StepZero sheet used here sums to 278,240 registered BHWs — a
          difference of a few hundred that reflects ordinary drift between an official tally and this
          sheet export. The site computes its totals from the sheet.
        </p>
        <p className="text-sm text-muted">
          Two different notions of &quot;accredited&quot; exist and are not mixed: the StepZero
          count is a self-reported barangay tally, while the per-person{" "}
          <GlossaryTerm slug="accredited">accreditation</GlossaryTerm> figures come from each
          BHW&apos;s verified accreditation flag in the profiled dataset.
        </p>
        <p>
          StepZero&apos;s household counts also power{" "}
          <GlossaryTerm slug="households_per_bhw">Households per BHW</GlossaryTerm>, shown alongside
          the headcount everywhere Total BHWs appears: households divided by Total BHWs, giving
          roughly how many households each BHW serves. BHWs in the Philippines are assigned to
          households, so this ratio — rather than a per-capita rate — is the workload measure that
          matters, and it lets places of very different sizes be compared. It&apos;s shown only
          where StepZero has a household figure for that area.
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
          Unless stated otherwise, a per-person percentage&apos;s denominator is the number of{" "}
          <GlossaryTerm slug="validated_profile">validated profiles</GlossaryTerm> for the selected
          place and (for demographic breakdowns) the selected characteristic — not the total BHW
          headcount. Every figure shows its exact N in the &quot;Technical details&quot; disclosure.
        </p>
      </section>

      <section id="relationships" className="flex flex-col gap-2 scroll-mt-6">
        <h2 className="text-lg font-semibold">Relationships between indicators</h2>
        <p>
          The Explore relationships scatter compares two indicators across the places within an
          area, and summarizes their link with a{" "}
          <strong>Spearman rank correlation</strong> (ρ). Spearman measures whether places that rank
          high on one indicator tend to rank high (or low) on the other, without assuming the
          relationship is a straight line. The coefficient is translated to words using fixed
          thresholds on its absolute value:
        </p>
        <ul className="list-inside list-disc">
          <li>below 0.2 — no clear link;</li>
          <li>0.2 to 0.4 — a weak link;</li>
          <li>0.4 to 0.7 — a moderate link;</li>
          <li>0.7 and above — a strong link.</li>
        </ul>
        <p>
          Places with fewer than 30 profiled BHWs are excluded from the coefficient (their rates are
          unstable), and shown as hollow points. With fewer than 10 comparable places the tool
          reports &quot;too few places to assess a pattern&quot; instead of a number. Most
          importantly, this is an <strong>ecological</strong> comparison — it describes places, not
          individual BHWs — so a place-level link does not imply the same relationship holds person
          by person.
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

      <section id="ai" className="flex flex-col gap-2 scroll-mt-6">
        <h2 className="text-lg font-semibold">
          <GlossaryTerm slug="ai_generated">AI-generated</GlossaryTerm> insights
        </h2>
        <p>
          Some pages show a short AI-written insight alongside the figures. The model can only get
          numbers by calling the same lookup functions this site&apos;s pages use — it has no other
          way to answer with a number. After it writes an answer, every number in the text is
          checked against what those lookups actually returned; any sentence containing a number
          that can&apos;t be traced back is removed automatically before it&apos;s shown, rather
          than being published unchecked.
        </p>
        <p>
          Generation falls back through several free-tier AI providers in a fixed order, and is
          cached per place so most visitors see a precomputed answer rather than a live call. When
          every provider is at capacity, the insight is simply left out — the template figures and
          headlines throughout the rest of the site never depend on AI and always work.
        </p>
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
