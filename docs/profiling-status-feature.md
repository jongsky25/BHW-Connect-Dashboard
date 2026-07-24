# BHW Connect Profiling Status (2026)

A public, at-a-glance view of how far the **2026 individual-profiling** exercise has
progressed, plus a downloadable one-page summary. Each Barangay Health Worker moves through an
encoding pipeline **Encode → Validate → Attest**, measured against the total number of BHWs to be
profiled. Every BHW sits in exactly one of four mutually-exclusive stages, so the shares add up to
100%.

Covers all **18 regions** of the Philippines (1,655 city/municipalities; ~310K BHWs to profile),
loaded from the national grouped-by-citymun export. (The first load was Region VIII only; the
national seed superseded it.)

## Decisions

- **Separate 2026 dataset.** Distinct from the 2025 BHW data — its own dataset slug
  (`bhw-profiling-status-2026`), its own table, its own card. Not blended into the 2025 tiles.
- **Placement:** a dedicated card on `/bhw`, kept visually separate from the 2025 figures.
- **Denominator = ALL BHWs** = `registered + accredited + unregistered` (the 2026 goal is to
  profile every BHW — this overrides the 2025 "registered-only eligible base" logic).
- **Stages = four mutually-exclusive buckets** derived from the five raw status buckets. Every BHW
  to profile is counted in exactly one, so they **partition the denominator and sum to 100%**:
  - **Encoded** = drafted + for_validation + back_to_encoder (in the pipeline, awaiting validation)
  - **Validated** = validated (validated, awaiting attestation)
  - **Attested** = approved (the finish line; formerly "Certified")
  - **Not yet encoded** = `total − (encoded + validated + attested)`
  - Each stage carries its count, its % of the total-BHW denominator, and a `fraction` for the
    stacked bar (normalized against the larger of the headcount and the pipeline so an overshooting
    snapshot still fills the bar exactly once).
- **Denominator is the hero** on every page (`StatusHero`), with the headline "still to attest"
  gap (`toAttest` = `total − attested`, floored at 0 on overshoot) beneath it.
- **Headline bar** (`FunnelBars`) is a single stacked 100% bar over the four stages, with a legend
  of count · %. The **bottleneck view** (`BottleneckBars`) then drills into just the *Encoded*
  bucket — drafted / awaiting validation / sent back for rework — where `back_to_encoder` is the
  rework/quality signal.
- **Rankings & flags:** `AreaRanking` (furthest-along vs. most-still-to-do child areas by % attested,
  only when there's real spread) and `CoverageFlags` (areas reporting, areas with none attested, and
  the >100% pipeline-exceeds-headcount artefact).
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

The Encoded/Validated/Attested/Not-encoded stage totals are **derived in the read layer**, not
stored, so the stage definition lives in one place (`lib/db/profiling-status.ts`).

## Refreshing / adding data

1. Obtain the "Encoding Status" export (same 15 columns; national grouped-by-citymun, or a
   single region).
2. Regenerate the seed migration:
   ```
   python ingestion/ingest_encoding_status.py \
     --src ingestion/data/encoding_status_national.csv \
     --out supabase/migrations/<timestamp>_seed_bhw_profiling_status_national.sql \
     --exclude 1380602,1380607,1380608,1380609
   ```
   The upsert (`on conflict … do update`) makes re-running safe. Every citymun `geo_code` must
   exist in `dim_geo` (`agg_bhw_profiling_status.geo_code` is a FK); use `--exclude` for codes it
   lacks — currently the 4 all-zero City-of-Manila districts `1380602/1380607/1380608/1380609`.
   Excluded citymuns are still counted in the province/region/national rollups.
3. Apply the migration (Supabase MCP `apply_migration`, or the repo's migration flow).

## Key files

| Area | Path |
| --- | --- |
| Read layer + funnel helpers | `lib/db/profiling-status.ts` (+ `.test.ts`) |
| Dataset slug | `lib/db/dataset.ts` (`DATASET_SLUGS.profilingStatus`) |
| Section landing + sub-pages | `app/profiling-status/` (`page.tsx`, `[geoLevel]/[geoCode]/page.tsx`, `methodology/`, `layout.tsx`) |
| Section components | `components/profiling-status/` (funnel-bars, child-breakdown, status-hero, bottleneck-bars, area-ranking, coverage-flags) |
| PNG one-pager | `lib/exports/profiling-status-figure.ts` + `app/api/export/profiling-status/route.ts` |
| Seed generator | `ingestion/ingest_encoding_status.py` |
| Source data | `ingestion/data/encoding_status_national.csv` (+ `encoding_status_region08.csv`) |

## Verification

- Seed: 1,788 rows (1,651 city/municipalities + 118 provinces + 18 regions + national); rollups
  checked (national == Σ cities == 310,493; province == Σ its cities). Spot-checks: ABUYOG
  `0803701`, JARO `0803723`, SANTO NIÑO `0806018`. National stages (mutually exclusive, sum to
  310,493): encoded 221,901 / validated 16,559 / attested 36,883 / not-yet-encoded 35,150.
- Stage math unit-tested in `lib/db/profiling-status.test.ts`.
- Routes verified end-to-end: `/api/profiling-status` (JSON drill-down, 404 on unknown geo)
  and `/api/export/profiling-status` (valid PNG, correct numbers).
