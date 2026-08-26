import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How the 2025 UUC for PHC list is defined — the physical and socio-economic criteria of DOH AO No. 2020-0023, the denominator, and how the 5,991 barangays were counted.",
};

export default function UucPhcMethodology() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Methodology</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What this is</h2>
        <p className="text-muted">
          The <strong>Unserved and Underserved Communities for Primary Health Care</strong> list
          names the barangays a primary-health-care programme is meant to reach first. It is a
          published list of places, not a survey of people — a barangay is either on it or not. The
          2025 edition was issued under <strong>DC No. 2025-0549</strong>.
        </p>
        <p className="text-muted">
          The programme was formerly known as GIDA (Geographically Isolated and Disadvantaged Areas)
          and SEDA (Socio-Economically Disadvantaged Areas). Those names are superseded; the
          criteria below are unchanged.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How a barangay qualifies</h2>
        <p className="text-muted">
          Under <strong>DOH AO No. 2020-0023</strong>, a barangay qualifies only when{" "}
          <strong>both</strong> a physical and a socio-economic factor are present. Meeting one
          alone is not enough.
        </p>
        <p className="text-muted">
          <strong>Physical factor</strong> — at least 25% of its sitios or puroks have no access to
          a rural health unit or hospital within 60 minutes of travel by any means,{" "}
          <em>including walking</em>.
        </p>
        <p className="text-muted">
          <strong>Socio-economic factor</strong> — at least one of:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-muted">
          <li>10% or more of the population are Indigenous Peoples;</li>
          <li>
            10% or more are affected by armed conflict or internally displaced, or the barangay is
            designated a conflict-affected area;
          </li>
          <li>50% or more of the population are enrolled in 4Ps / CCT;</li>
          <li>
            it performs worse than the latest provincial figure on at least 4 of 8 health indicators
            — infant and under-five mortality, fully immunised children, adolescent birth rate,
            contraceptive prevalence, 4+ pre-natal visits, skilled birth attendance, and access to
            improved water supply.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How areas are counted</h2>
        <p className="text-muted">
          Every figure on this dashboard is one count against one denominator:{" "}
          <strong>how many of an area&rsquo;s barangays are on the list</strong>, out of{" "}
          <strong>all barangays in that area</strong>. The denominator is the official barangay
          count for the area, so a share of 21% means roughly one barangay in five.
        </p>
        <p className="text-muted">
          Areas with none listed are shown as <strong>0</strong>, not as missing data. The list is a
          single national publication rather than a rolling collection, so an area with nothing on
          it was assessed and did not qualify.
        </p>
        <p className="text-muted">
          Region, province and city/municipality figures are sums of the barangays beneath them, so
          they add up exactly: the 17 regional counts sum to the national total.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The published total</h2>
        <p className="text-muted">
          This dashboard publishes <strong>5,991</strong> barangays, the figure the source workbook
          carries. The 2027 Budget Cue Cards give <strong>5,987</strong> for the same list as of DC
          No. 2025-0549; the difference is 5 barangays in CALABARZON and 1 in BARMM. The workbook
          states 5,991 in three independent places — its classification sheet, its list of
          barangays, and its own regional subtotals — so that is the figure rendered here, with the
          published 5,987 noted rather than silently reconciled.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">One geography note</h2>
        <p className="text-muted">
          Sulu was removed from BARMM in 2024. The source files Sulu&rsquo;s barangays under Region
          IX by code while naming them under BARMM; this dashboard follows the source&rsquo;s own
          region names, which keeps every regional count identical to the published table. Sulu
          therefore appears under BARMM here.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">The indicator values</h2>
        <p className="text-muted">
          Open any barangay on a city or municipality page to see the factors it qualified on and
          its seven health indicators, each compared against its province — which is the comparison
          criterion (d) is built on.
        </p>
        <p className="text-muted">
          The direction differs by indicator, and the comparison respects it: a <em>higher</em>{" "}
          infant mortality is worse, while a <em>higher</em> immunisation coverage is better.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Reading a value marked †</h2>
        <p className="text-muted">
          Some values arrived recorded above the maximum their indicator can take — water coverage
          as high as 9,594%, immunisation at 18,088. These were bounded to the maximum: 100% for
          coverage indicators, 1,000 for rates per 1,000. In total{" "}
          <strong>1,584 values across 1,397 barangays</strong> were bounded, most of them water
          supply (886) and immunisation (456).
        </p>
        <p className="text-muted">
          A bounded value is <strong>a ceiling, not a measurement</strong>. A barangay marked † at
          100% is not known to have full coverage — its recorded figure was impossible and the true
          one is unknown. Every bounded value carries the mark wherever it appears, which is the
          only reason these columns can be published at all.
        </p>
        <p className="text-muted">
          For the same reason this dashboard publishes{" "}
          <strong>no averages of these indicators</strong>. A mark can travel with a single value;
          it cannot survive a mean. An average water-coverage figure would silently absorb 886
          ceilings and report near-universal coverage the data does not support.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">When a comparison is not made</h2>
        <p className="text-muted">
          Two cases show as unavailable rather than as a result, because in neither does the source
          support a conclusion:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-muted">
          <li>
            <strong>No provincial figure</strong> — 57 barangays sit in provinces that supplied
            none. Criterion (d) cannot be evaluated for them; that is not the same as passing it.
          </li>
          <li>
            <strong>A benchmark above the indicator&rsquo;s maximum</strong> — in two provinces the
            immunisation benchmark was left above 100% while every barangay&rsquo;s own figure was
            bounded to 100%. No barangay there could match it, so &ldquo;worse than province&rdquo;
            would be true by construction. Those 113 barangays show the benchmark and no verdict.
          </li>
        </ul>
      </section>

      <p className="text-sm text-muted">
        <Link href="/uuc-phc" className="underline hover:text-accent">
          ← Back to the overview
        </Link>
      </p>
    </div>
  );
}
