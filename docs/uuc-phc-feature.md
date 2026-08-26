# UUC for PHC 2025

A public view of the **2025 list of Unserved and Underserved Communities for Primary Health
Care** — the barangays a primary-health-care programme is meant to reach first. **5,991 barangays**
of the country's 41,958, issued under **DC No. 2025-0549** with criteria set by **DOH AO No.
2020-0023**.

Unlike the BHW datasets, this is a *membership list*, not a measurement: a barangay is either on
it or not. Every figure on the section is therefore one count against one denominator.

## Decisions

- **Separate dataset and section.** Own slug (`uuc-phc-2025`), own table, own `/uuc-phc` section
  with its own chrome — this is a targeting list of places, not a BHW measure, so it is not a card
  on `/bhw`.
- **Only the listed barangays are loaded.** The source workbook also carries 9,395 assessed-but-not
  listed barangays; they are out of scope (owner decision), so `fact_uuc_phc_barangay` has no
  `decision` column and membership is presence. See `docs/UUC_PHC_2025_PLAN.md` U1.
- **The denominator is `dim_geo`'s barangay count** — every barangay in the area, not the
  workbook's assessed subset. "3 of the 42 barangays in this town" is the statement a reader wants,
  and 42 is a fact about the town. The workbook's assessed set would answer a different question
  with a denominator missing the 769 barangays it could not resolve.
- **A zero is data, not a gap.** `agg_uuc_phc_counts` carries a row for *every* geo, so NCR reads
  "0 of 1,675" with an explicit note that the list is national and complete. This is the one place
  the design departs from the profiling-status section, whose source is loaded region by region and
  so must say "not loaded yet".
- **The listed count is the hero**, with the denominator and share beneath it — the reverse of
  `StatusHero`, where the denominator is the story.
- **One bar, two states.** `ShareBar` is a single 100% track split listed / not listed. There is no
  funnel here; drawing one would invent stages the data does not have.
- **Child tables sort by share, not by raw count.** Ordering by count alone just re-ranks areas by
  how many barangays they happen to have.
- **The drill-down ends at city/municipality**, which names every one of its barangays and whether
  each is on the list. A barangay page would be a single yes/no, so `/uuc-phc/barangay/*` 404s.
- **Not built:** PNG one-pager (U4, optional), indicator views (U3 — blocked on a display rule for
  capped values), and an `/explore` overlay (worth doing, after this).

## Data model

- Table **`fact_uuc_phc_barangay`** — one row per listed barangay: resolved `geo_code`,
  `source_geo_code` as the workbook supplies it, and the source's own region/province/citymun/
  barangay names for provenance. Public-read.
- Table **`agg_uuc_phc_counts`** — public-read aggregate keyed `(dataset_id, geo_code, geo_level)`
  at national / region / province / citymun. Two columns: `n_listed` and `n_barangays`. **1,788
  rows** (1 + 18 + 118 + 1,651).
  - **No barangay-level rows** — 41,958 rows of `n_listed` in {0,1} would only restate the fact
    table. A citymun page reads its barangays from the fact table directly.
  - **Computed in SQL from `fact_uuc_phc_barangay` + `dim_geo`**, so there is no generated seed to
    drift: re-running the migration recomputes every row. That *is* the refresh procedure.
- The **share** is derived in the read layer (`lib/db/uuc-phc.ts`), not stored — one definition,
  one place, the same discipline as the profiling-status stage totals.
- Dataset row in `dim_dataset` (`uuc-phc-2025`, `geo_join_level = 'barangay'`, status `published`).

## Refreshing / adding data

1. Replace the reconciled workbook in `ingestion/data/` and regenerate the cleaned extract:
   ```
   python ingestion/clean_uuc_phc_indicators.py
   ```
2. Regenerate the fact seed and apply it (idempotent upsert):
   ```
   python ingestion/ingest_uuc_phc.py \
     --out supabase/migrations/<timestamp>_seed_fact_uuc_phc_barangay.sql
   ```
3. Re-run the aggregate block of `20260826140000_agg_uuc_phc_counts.sql`. It recomputes from the
   fact table, so it needs no regeneration — only re-execution, after the fact seed.

The loader refuses to emit on a failed check (row count, PSGC format, duplicates, `UUA`-only, the
87-code Sulu count, all 17 regional counts): a silently short load is worse than a failed one when
5,991 is a headline figure.

## Key files

| Area | Path |
| --- | --- |
| Read layer + share helper | `lib/db/uuc-phc.ts` (+ `.test.ts`) |
| Dataset slug | `lib/db/dataset.ts` (`DATASET_SLUGS.uucPhc`) |
| Section landing + sub-pages | `app/uuc-phc/` (`page.tsx`, `[geoLevel]/[geoCode]/page.tsx`, `methodology/`, `layout.tsx`) |
| Section components | `components/uuc-phc/` (coverage-hero, share-bar, child-breakdown, barangay-list) |
| Fact loader | `ingestion/ingest_uuc_phc.py` |
| Cleaning step | `ingestion/clean_uuc_phc_indicators.py` |
| Source data | `ingestion/data/uuc_phc_2025_cleaned.csv` |
| Plan + provenance | `docs/UUC_PHC_2025_PLAN.md`, `docs/UUC_PHC_2025_CLEANING_REPORT.md` |

## Verification

- Aggregate: **1,788 rows**; national 5,991 of 41,958; sum of regions = sum of provinces = sum of
  citymuns = **5,991**; every province equals the sum of its citymuns and every region the sum of
  its provinces (**0 mismatches**); no area has `n_listed > n_barangays`; exactly **1 region (NCR)**
  reads zero.
- Regional counts reproduce the source workbook's own table at **all 17 regions** — see
  `docs/UUC_PHC_2025_PLAN.md` §4 for why Sulu's placement decides this.
- Share math unit-tested in `lib/db/uuc-phc.test.ts`, including the zero-denominator and
  "none listed" cases that must not collapse into each other.
- Routes verified against live data: `/uuc-phc` (5,991 / 41,958 / 14%, regions ranked with CAR at
  52%), `/uuc-phc/region/14`, `/uuc-phc/province/14027` (11 cities ranked by share),
  `/uuc-phc/citymun/1402706` (MAYOYAO, 27 of 27, all named), `/uuc-phc/citymun/0102804` (BANGUI,
  2 of 14, both groups named), `/uuc-phc/region/13` (NCR, 0 of 1,675 with the "result, not missing
  data" note), `/uuc-phc/methodology`. Unknown geos and `/uuc-phc/barangay/*` 404.
