import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "Where the health facility data comes from, how it joins to Philippine geography, what it records about licensing, and which columns are deliberately not published.",
};

export default function FacilitiesMethodology() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Methodology</h1>
        <p className="text-muted">
          What this section publishes, where it came from, and what it cannot tell you.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Source and snapshot</h2>
        <p className="text-sm text-muted">
          The Department of Health&apos;s{" "}
          <strong>National Health Facility Registry</strong> (NHFR), exported from the public site{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-xs">nhfr.doh.gov.ph</code> and
          retrieved on <strong>5 September 2026</strong>. It carries{" "}
          <strong>44,799 facilities</strong> across all 18 regions.
        </p>
        <p className="text-sm text-muted">
          NHFR is a <em>live</em> registry, continuously updated, rather than a periodic
          publication. This section therefore publishes a point-in-time snapshot: figures here are
          what the registry said in September 2026, and a later export is a new edition rather than
          a correction of this one.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          What &quot;licence status&quot; does and does not mean
        </h2>
        <p className="text-sm text-muted">
          <strong>
            A facility shown as &quot;licence status not stated&quot; is not an unlicensed
            facility.
          </strong>{" "}
          The source records a licensing status for 16,552 of the 44,799 facilities — 15,441 with a
          licence and 1,111 without. The remaining 28,247 carry no status at all, and they are
          overwhelmingly barangay health stations, which are not a licensed facility type in the
          first place.
        </p>
        <p className="text-sm text-muted">
          For that reason this section publishes no &quot;percent licensed&quot; figure at any
          level. The denominator such a figure needs — which facilities are supposed to hold a
          licence — is not knowable from this export, and a percentage computed without it would
          read as a compliance rate while measuring something else entirely.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Geography</h2>
        <p className="text-sm text-muted">
          Every facility in the export carries Philippine Standard Geographic Codes for its region,
          province, city/municipality and barangay. All four are clean 10-digit codes, so joining
          them to this site&apos;s geography needed no address matching or geocoding.
        </p>
        <p className="text-sm text-muted">
          <strong>108 of the 44,799 facilities carry no barangay code.</strong> They are counted in
          every facility total, because each still carries a city/municipality, but they cannot
          count toward the &quot;barangays with at least one facility&quot; figure. At national
          level that is 108 facilities out of 44,799.
        </p>
        <p className="text-sm text-muted">
          <strong>Sulu appears under BARMM here, and the source disagrees.</strong> The export
          names all 177 Sulu facilities under Region IX, following Sulu&apos;s 2024 removal from
          BARMM, while its codes straddle both vintages — 152 carry BARMM-era codes and 25 carry
          Region IX ones. This site&apos;s geography is fixed on the vintage that still holds Sulu
          under BARMM, and the rollups follow the code rather than the name so that a facility
          lands in exactly one place. The alternative — editing the underlying geography — would
          retroactively move every existing figure for Sulu in every other dataset on this site.
        </p>
        <p className="text-sm text-muted">
          A consequence worth stating: <strong>21 Sulu barangays are listed twice</strong> in the
          export, once under each code vintage. Resolving both onto the same barangay is what
          collapses them, which is why the number of barangays with a facility (28,490) is lower
          than the number of distinct barangay codes the export prints (28,511). The facilities
          themselves are not duplicated — each has its own registry code.
        </p>
        <p className="text-sm text-muted">
          Some places on the registry have no entry in this site&apos;s geography at all, because
          that geography was built from the 2025 BHW census and a place with facilities but no
          profiled BHW never appeared in it. Four districts of the City of Manila — Binondo, San
          Miguel, Ermita and Intramuros — are in that position, and are added explicitly rather
          than dropped.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">What is deliberately not published</h2>
        <p className="text-sm text-muted">
          The source export carries contact columns — email addresses, landline and fax numbers,
          websites — and street addresses. <strong>None of them are loaded here.</strong> Of the
          20,194 email addresses in the export, 18,413 are free webmail accounts: in practice these
          are the personal addresses of individual midwives, proprietors and staff rather than
          institutional contacts. Republishing them as open data would put roughly eighteen
          thousand people&apos;s personal contact details onto a public page, which is not what a
          facility inventory is for.
        </p>
        <p className="text-sm text-muted">
          What this section publishes is the facility, its type, who owns it, the barangay it is
          in, its bed capacity, and its licence status where the source states one.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Counting rules</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          <li>
            <strong>A zero is data.</strong> Every area has a row, so an area with no facilities
            reads &quot;0 facilities&quot; rather than disappearing. For this dataset that is the
            finding, not an absence.
          </li>
          <li>
            <strong>No small-cell suppression.</strong> This is an inventory of places, not of
            people, so the privacy rule that suppresses small person-level cells elsewhere on this
            site does not apply. The personal columns the source carried were dropped at ingestion
            rather than aggregated away.
          </li>
          <li>
            <strong>Ownership is taken from the registry&apos;s own classification.</strong>{" "}
            Fifteen facilities carry contradictory government and private sub-classifications; for
            those the major classification is treated as authoritative and the contradicting
            sub-classification discarded.
          </li>
          <li>
            <strong>Coverage means &quot;any facility at all&quot;</strong> — a barangay with a
            single health station and one with a hospital both count as covered. It is a measure of
            presence, not of adequacy.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Use and attribution</h2>
        <p className="text-sm text-muted">
          The registry is published by the Department of Health and is publicly downloadable.
          Figures derived from it here are published with the source and retrieval date stated
          above. See the site{" "}
          <Link href="/methodology" className="underline hover:text-accent">
            methodology
          </Link>{" "}
          for how this dataset sits alongside the BHW census.
        </p>
      </section>
    </div>
  );
}
