import type { Metadata } from "next";
import { DatasetCard } from "@/components/portal/dataset-card";

// Absolute title so the root layout's "%s · BHW Connect" template — which is
// correct for the BHW dataset pages — doesn't get appended to the portal, which
// sits above any single dataset.
export const metadata: Metadata = {
  title: { absolute: "Equity in Health · Data & innovation" },
  description:
    "A repository of open, publicly available health datasets and innovations — no individual-level data.",
};

// The portal is a static front door: no data fetching, so a plain Server
// Component. It supplies its own slim chrome (the shared BHW Header/Footer hide
// themselves on "/"), keeping the hub visually distinct from any one dataset.
export default function Portal() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
      {/* Slim portal header — the hub's own brand, not the BHW nav. */}
      <header className="flex items-center">
        <span
          className="equity-mark md"
          role="img"
          aria-label="Equity in Health"
        />
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center gap-4 pt-4 text-center">
        <span className="equity-mark lg" role="img" aria-label="Equity in Health" />
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Equity in Health</h1>
        <p className="text-lg text-muted">Data &amp; innovation</p>
        <p className="max-w-2xl text-muted">
          A repository of open, publicly available health datasets and innovations — a shared
          front door to the work of the Equity in Health Section.
        </p>
      </section>

      {/* Disclaimer — publicly available data, no PII. */}
      <section
        aria-label="Data privacy"
        className="rounded-lg border border-border bg-surface p-4 text-sm text-muted sm:p-5"
      >
        <p>
          Everything here uses publicly available data with no personally identifiable
          information. These dashboards never show or export individual-level records — only
          aggregate counts and percentages, with small groups suppressed to prevent
          re-identification.
        </p>
      </section>

      {/* Dataset cards — one live dataset today, with placeholders signalling the
          section's ways forward. */}
      <section aria-label="Datasets" className="flex flex-col gap-4">
        <h2 className="sr-only">Datasets</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DatasetCard
            title="Barangay Health Workers (BHW)"
            description="The Philippine BHW workforce — accreditation, training, demographics, and honorarium, down to the city/municipality level."
            href="/bhw"
          />
          <DatasetCard
            title="More datasets"
            description="Additional open health datasets held by the section are being prepared for release here."
          />
          <DatasetCard
            title="Ways forward"
            description="Analyses and innovations built on these datasets will join the repository as they mature."
          />
        </div>
      </section>

      {/* Attribution */}
      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-6 text-sm text-muted">
        <span className="equity-mark sm" aria-hidden="true" />
        <span>An Equity in Health Section innovation.</span>
      </footer>
    </div>
  );
}
