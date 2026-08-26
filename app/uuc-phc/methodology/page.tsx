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
        <h2 className="text-lg font-semibold">What is not here yet</h2>
        <p className="text-muted">
          The source also carries per-barangay indicator values — mortality rates, immunisation,
          pre-natal and skilled-birth-attendance coverage, water access. They are not shown yet: a
          substantial number were recorded out of range and had to be bounded, and a bounded value
          is indistinguishable from a genuine one once rendered. They will be published once they
          can be shown with that distinction intact.
        </p>
      </section>

      <p className="text-sm text-muted">
        <Link href="/uuc-phc" className="underline hover:text-accent">
          ← Back to the overview
        </Link>
      </p>
    </div>
  );
}
