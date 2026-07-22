# BHW Connect Profiling Status (2026)

A public, at-a-glance view of how far the **2026 individual-profiling** exercise has
progressed, plus a downloadable one-page summary. Each Barangay Health Worker moves through a
three-step encoding pipeline **Encode → Validate → Certify**, measured against the total
number of BHWs to be profiled.

Starts with **Region VIII (Eastern Visayas)** and is designed to grow region-by-region to all
of the Philippines.

## Decisions

- **Separate 2026 dataset.** Distinct from the 2025 BHW data — its own dataset slug
  (`bhw-profiling-status-2026`), its own table, its own card. Not blended into the 2025 tiles.
- **Placement:** a dedicated card on `/bhw`, kept visually separate from the 2025 figures.
- **Denominator = ALL BHWs** = `registered + accredited + unregistered` (the 2026 goal is to
  profile every BHW — this overrides the 2025 "registered-only eligible base" logic).
- **Pipeline = cumulative funnel** over the five mutually-exclusive status buckets:
  - **Encoded** = drafted + for_validation + back_to_encoder + validated + approved
  - **Validated** = validated + approved
  - **Certified** = approved
  - Invariant: Encoded ≥ Validated ≥ Certified; each shown as % of the total-BHW denominator.
- **Denominator is the hero** on every page (`StatusHero`), with the headline "still to certify"
  gap (`total − certified`) beneath it. Each funnel step also carries its **remaining** count and
  **% to go** — the complement of `pctCapped`, derived once in `step()` (`remaining` floored at 0
  on overshoot).
- **Bottleneck view** (`BottleneckBars`) re-splits the same population into mutually-exclusive
  *current* states (drafted / awaiting validation / rework / awaiting certification / certified /
  not yet encoded) to show where records pile up — `back_to_encoder` is the rework/quality signal.
- **Rankings & flags:** `AreaRanking` (furthest-along vs. most-still-to-do child areas, only when
  there's real spread) and `CoverageFlags` (areas reporting, areas at 0% certified, and the >100%
  encoded-exceeds-headcount artefact).
- **Drill-down** goes national → region → province → city/municipality. The **barangay** level is
  wired in the UI (heading + graceful "no barangay data yet" note) but has no rows, since the
  source sheets are city/municipality-grain.
- **Not built (data-limited):** trend / velocity / projected-completion (needs periodic snapshots)
  and an interactive choropleth (reuses the heavy `ChoroplethMap` + ranked-list scaffolding from
  `/explore`; the `AreaRanking` list is the accessible stand-in for now).
- **Download = PNG one-pager** (reuses `@resvg/resvg-js`; no `pdf-lib` — the repo has no PDF
  machinery).

## Data model

- Table **`agg_bhw_profiling_status`** — public-read aggregate keyed by
  `(dataset_id, geo_code, geo_level)`, seeded at every geo level (city/municipality rows plus
  province/region/national rollups). Columns: the three universe buckets + `n_total_bhw`
  (denominator) and the five pipeline buckets. Mirrors `agg_bhw_stepzero_counts`.
- Dataset row in `dim_dataset` (`bhw-profiling-status-2026`, status `published`).
- Migrations: `supabase/migrations/20260722120000_agg_bhw_profiling_status.sql` (table),
  `…120100_seed_dim_dataset_profiling_status.sql` (dataset), `…120200_seed_bhw_profiling_status.sql`
  (seed, generated).

The Encode/Validate/Certify totals are **derived in the read layer**, not stored, so the funnel
definition lives in one place (`lib/db/profiling-status.ts`).

## Adding a new region

1. Obtain the region's "Encoding Status" sheet (same columns as Region VIII).
2. Regenerate the seed migration:
   ```
   python ingestion/ingest_encoding_status.py \
     --src ingestion/data/<region>.csv \
     --out supabase/migrations/<timestamp>_seed_bhw_profiling_status_<region>.sql
   ```
   The upsert (`on conflict … do update`) makes re-running safe; new regions append their own
   rows. Every `geo_code` must exist in `dim_geo` (the generator's QA output flags any that
   don't — e.g. a High Urbanized City treated as its own province, like Tacloban `08316`).
3. Apply the migration (Supabase MCP `apply_migration`, or the repo's migration flow).

## Key files

| Area | Path |
| --- | --- |
| Read layer + funnel helpers | `lib/db/profiling-status.ts` (+ `.test.ts`) |
| Dataset slug | `lib/db/dataset.ts` (`DATASET_SLUGS.profilingStatus`) |
| Card (server) | `components/home/profiling-status-card.tsx` |
| Card drill-down (client) | `components/home/profiling-status-panel.tsx` |
| Drill-down JSON API | `app/api/profiling-status/route.ts` |
| PNG one-pager | `lib/exports/profiling-status-figure.ts` + `app/api/export/profiling-status/route.ts` |
| Seed generator | `ingestion/ingest_encoding_status.py` |
| Source data | `ingestion/data/encoding_status_region08.csv` |

## Verification

- Seed: 143 city/municipalities for Region VIII; rollups checked (national == Σ cities,
  province == Σ its cities). Spot-checks: ABUYOG `0803701`, JARO `0803723`, SANTO NIÑO `0806018`.
- Funnel math unit-tested in `lib/db/profiling-status.test.ts`.
- Routes verified end-to-end: `/api/profiling-status` (JSON drill-down, 404 on unknown geo)
  and `/api/export/profiling-status` (valid PNG, correct numbers).
