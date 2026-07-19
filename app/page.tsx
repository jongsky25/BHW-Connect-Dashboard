import { getBhwCounts, getGeoSummary } from "@/lib/db/indicators";
import { getSpotlightInsight } from "@/lib/db/spotlight";
import { GeoSearch } from "@/components/home/geo-search";
import { StatTile } from "@/components/home/stat-tile";

const CAPTION = "N = {n} BHWs · Philippines · 2025 snapshot";

function formatCount(n: number | null) {
  return n === null ? "—" : n.toLocaleString();
}

function formatPct(n: number | null) {
  return n === null ? "—" : `${n}%`;
}

export default async function Home() {
  const [counts, summary, spotlight] = await Promise.all([
    getBhwCounts("PH", "national"),
    getGeoSummary("PH"),
    getSpotlightInsight(),
  ]);

  const caption = CAPTION.replace("{n}", formatCount(counts?.nTotal ?? null));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <section className="flex flex-col items-center gap-5 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Barangay Health Workers, in your barangay
        </h1>
        <p className="max-w-2xl text-muted">
          BHW Connect is a public dashboard on the Philippines&apos; Barangay Health Worker
          workforce — accreditation, training, and support, down to the city/municipality level.
        </p>
        <GeoSearch />
      </section>

      <section aria-label="National figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total BHWs" value={formatCount(counts?.nTotal ?? null)} caption={caption} />
        <StatTile
          label="Accredited"
          value={formatPct(counts?.pctAccredited ?? null)}
          caption={caption}
        />
        <StatTile
          label="Receive any honorarium"
          value={formatPct(counts?.anyHonorariumPct ?? null)}
          caption={caption}
        />
        <StatTile
          label="Top training gap"
          value={summary?.topTrainingGap ?? "—"}
          caption={caption}
        />
      </section>

      {spotlight && (
        <section
          aria-label="Spotlight insight"
          className="rounded-lg border border-accent/30 bg-accent-subtle p-5 sm:p-6"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-accent">
            Spotlight insight
          </p>
          <p className="mt-2 text-lg font-medium">{spotlight.headline}</p>
          <p className="mt-1 text-xs text-muted">{spotlight.caption}</p>
        </section>
      )}
    </div>
  );
}
