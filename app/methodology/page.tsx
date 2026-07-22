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
        <p>
          One axis may be an <strong>external variable</strong> rather than a BHW-workforce
          indicator: <strong>poverty incidence</strong> from the{" "}
          <GlossaryTerm slug="poverty_incidence">PSA Small Area Estimates (2023)</GlossaryTerm>, at
          city/municipality grain. External variables appear only here on the relationships axes —
          never on the workforce map — and every rendering carries its source. Because the estimates
          stop at city/municipality, poverty is offered only when the places being compared are
          cities/municipalities (a province view). Highly Urbanized Cities are a separate SAE domain
          and carry no estimate; full coverage and reconciliation notes are in{" "}
          <code>docs/POVERTY_SAE.md</code>. Cite: PSA 2023 City- and Municipal-Level Small Area
          Estimates of Poverty.
        </p>
      </section>

      <section id="derived-indicators" className="flex flex-col gap-2 scroll-mt-6">
        <h2 className="text-lg font-semibold">Recency, per-capita, and accreditation sources</h2>
        <ul className="list-inside list-disc">
          <li>
            <strong>Median last-trained year.</strong> For each training topic, the middle year
            among the BHWs recorded as trained. A topic whose median is 5 or more years before the
            snapshot (2020 or earlier for the 2025 snapshot) is flagged as possibly due for a
            refresher. This is a recency signal, separate from how many BHWs are trained.
          </li>
          <li>
            <strong>BHWs per 1,000 residents.</strong> Total BHWs divided by population, times
            1,000. Population is the{" "}
            <GlossaryTerm slug="census_population">PSA 2024 census count</GlossaryTerm> (POPCEN),
            name-matched to each area; where a census figure is unavailable (an area with no
            matching census entry) it falls back to the approximate self-reported StepZero
            population. City/municipality is the finest census grain, so barangay-level figures use
            the city/municipality count. Full source-matching and reconciliation notes are in{" "}
            <code>docs/POPULATION_RECONCILIATION.md</code>.
          </li>
          <li>
            <strong>Accreditation, two sources.</strong> The StepZero quick-count reports an
            accredited share of the whole BHW universe (
            <GlossaryTerm slug="lgu_reported_accreditation">LGU-reported accreditation</GlossaryTerm>
            ), while the verified rate counts only individually validated profiles. These come from
            different sources with different denominators, so they are shown side by side and never
            averaged; a gap between them is a data-quality signal, not an error.
          </li>
          <li>
            <strong>Peer rank &amp; outliers.</strong> Each area is ranked among its same-level
            siblings — provinces within their region, cities/municipalities within their province,
            regions nationally — for each base indicator, with a percentile (0 = lowest, 100 =
            highest). An area is flagged as standing out when its value is more than 3× the median
            absolute deviation from the group median, and only in groups of at least 8 siblings, so
            small groups don&apos;t manufacture outliers. Ranks are hidden for areas with fewer than
            30 profiled BHWs, where the underlying value is too unstable to rank fairly.
          </li>
          <li>
            <strong>Data-completeness grade.</strong> A single letter summarizing how filled-in the
            profiles are for an area:{" "}
            <GlossaryTerm slug="data_completeness">data completeness</GlossaryTerm> is the average,
            across every tracked field (age, sex, civil status, blood type, education, IP status,
            household count, active-service years), of the share of records where that field is
            present. Each field counts equally — no editorial weighting. The grade is A at 95% or
            higher average completeness, B at 85% or higher, and C below that; the worst field is
            named when it is missing for at least 10% of records. Completeness is computed down to
            the city/municipality level, so a barangay shows its city/municipality&apos;s grade.
          </li>
        </ul>
      </section>

      <section id="adjusted-rates" className="flex flex-col gap-2 scroll-mt-6">
        <h2 className="text-lg font-semibold">
          Joining waves, workload, honorarium inequality, and adjusted rates
        </h2>
        <ul className="list-inside list-disc">
          <li>
            <strong>Joining waves.</strong> How many of today&apos;s profiled BHWs reached each
            milestone — first became active, registered, accredited — in each year, read from the
            2025 snapshot. Years are as recorded in that snapshot. This is not a picture of the
            workforce over time: it counts only BHWs still in the 2025 registry, so anyone who joined
            and left before 2025 is not shown. Read it as &ldquo;when today&apos;s BHWs
            arrived,&rdquo; never as a headcount per year.
          </li>
          <li>
            <strong>Household workload.</strong> The spread of assigned households per BHW
            (10th/25th/median/75th/90th percentile), plus the &ldquo;busiest 10%&rdquo; share — how
            much of an area&apos;s total assigned households fall to its highest-caseload tenth of
            BHWs (10% would be perfectly even; higher means load concentrates on fewer workers).
            Household counts are self-reported; counts of zero are excluded. Built down to the
            city/municipality level and hidden where fewer than 5 BHWs report a count.
          </li>
          <li>
            <strong>Honorarium inequality.</strong> Among BHWs who receive any{" "}
            <GlossaryTerm slug="honorarium">honorarium</GlossaryTerm> in an area, we total each
            person&apos;s monthly honorarium across every paying level and measure how unevenly those
            totals are spread: the <GlossaryTerm slug="gini">Gini coefficient</GlossaryTerm> (0 =
            everyone equal, 1 = one person receives all) and the p90:p10 ratio (the best-paid
            tenth&apos;s floor divided by the least-paid tenth&apos;s ceiling). Hidden where fewer
            than 5 BHWs receive honorarium, since a spread over 1–4 amounts could reveal an
            individual&apos;s pay.
          </li>
          <li>
            <strong>Honorarium sufficiency.</strong> Every profiled BHW in an area — not only
            those who receive something — is placed in a band by their{" "}
            <GlossaryTerm slug="honorarium_sufficiency">cumulative monthly honorarium</GlossaryTerm>{" "}
            summed across every paying level (None, ₱1–4,000, … Over ₱24,000), answering the
            deck&apos;s &ldquo;is it enough?&rdquo; question directly: the share of BHWs below a
            ₱2,040/month sufficiency cut (≈₱68/day, using the same 30-day-month convention as
            elsewhere on this page). Nationally, 59.2% of profiled BHWs fall below that cut, and
            the national median cumulative honorarium is ₱1,750/month (~₱58/day). Built down to
            the city/municipality level and hidden where fewer than 5 BHWs are profiled; a band
            with fewer than 5 BHWs in it is withheld even when the area overall is shown.
          </li>
          <li>
            <strong>Support by LGU income class.</strong> Accreditation, any-honorarium share, and
            median honorarium grouped by the{" "}
            <GlossaryTerm slug="income_class">income class</GlossaryTerm> of each BHW&apos;s
            city/municipality (1st highest, 5th lowest) — a national-scope equity lens. Income
            classes are the DOF Department Order No. 074-2024 reclassification under RA 11964 (the
            Automatic Income Classification of LGUs Act, effective 1 January 2025), which replaced
            the older six-class ladder with five classes. The DOF schedule lists no PSGC codes, so it
            is name-matched to each LGU (province-scoped and NIR-aware); the mapping, the handful of
            LGUs the source leaves unclassified, and every reconciliation note are recorded in{" "}
            <code>docs/INCOME_RECLASS.md</code>. Cite: DOF DO 074-2024.
          </li>
          <li>
            <strong>Adjusted accreditation rate.</strong> A raw percentage from a place with only a
            handful of profiled BHWs is noisy — one person swings it several points. The{" "}
            <GlossaryTerm slug="adjusted_rate">adjusted rate</GlossaryTerm> shrinks each small-area
            raw rate toward its parent area&apos;s pooled rate, using an empirical-Bayes
            (DerSimonian–Laird random-effects) estimate of how much real spread there is between
            neighbouring areas. Where neighbours genuinely differ, rates barely move; where the
            spread looks like noise, small areas are pulled toward the typical nearby value. A large,
            well-measured area keeps almost its raw rate. Worked example: a municipality with 13
            profiled BHWs and a raw 38% accreditation, in a province averaging 81%, is adjusted to
            about 57% — the small sample is nudged toward its province without erasing its real
            difference. Only computed at the city/municipality and barangay levels, where small
            numbers occur; regions and the nation are always shown raw. Raw is the default everywhere;
            the adjusted view is an opt-in toggle, always labelled.
          </li>
        </ul>
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
          <li>
            Retention and attrition can&apos;t be measured from this snapshot. Because it records
            only BHWs still active in 2025, anyone who left earlier is absent, so every starting
            cohort appears almost fully &ldquo;retained&rdquo; — a survivorship artefact, not a real
            finding. We therefore don&apos;t publish a retention curve; the joining-waves figure is
            framed strictly as when today&apos;s BHWs arrived.
          </li>
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
        <p>
          Questions asked in the &ldquo;Ask the data&rdquo; chat may be stored (with the checked
          answer they received) to improve responses: a question that has already been asked and
          verified against the current dataset can be answered instantly from that stored answer
          — such answers are labeled in the chat. Stored answers are tied to the dataset version
          they were checked against and are discarded when the data is refreshed. Don&apos;t
          include personal information in chat questions.
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
