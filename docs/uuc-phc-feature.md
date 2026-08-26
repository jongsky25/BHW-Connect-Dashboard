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
- **Indicators render at barangay grain only, never as averages** (U3). A capped value carries a †
  marker; a marker cannot survive a mean. See "The indicators" below.
- **A PNG one-pager per area** (U4), reusing the profiling-status export machinery. It carries the
  count, the two-state split and the child table — **but no indicator values**: a one-pager cannot
  carry the † marker's footnote, and reproducing bounded values without it is exactly the unmarked
  artefact U3 was built to avoid.
- **All four relations are registered and queryable by the internal assistant** (U5). The column
  dictionaries are the allowlist `queryDataset` enforces, not documentation: `capped_indicators`
  and each of the seven boundable indicators carry the capping caveat in the column meaning
  itself, because that is what travels with a returned value.
- **Not built yet:** an `/explore` overlay, present mode, ask-the-data chat, an AI insight slot,
  and the sub-pages that would show the criteria, the indicator distributions and the data-quality
  caveats above barangay grain. All planned as U6–U12 in `docs/UUC_PHC_2025_PLAN.md` §8–§9.

## The indicators (U3)

Each listed barangay on a city/municipality page expands (`<details>`, no client JS) to show the
factors it qualified on and its seven health indicators, each compared against its province — the
comparison criterion (d) is built on.

- **The comparison respects each indicator's direction.** Higher infant mortality is worse; higher
  immunisation coverage is better. One comparison applied to all seven would invert half of them.
- **Capped values are marked wherever they appear.** 1,584 values across 1,397 barangays were
  bounded during cleaning (Water 886, FIC 456, Pre-natal 208, SBA 30, ABR 2, IMR 1, UFMR 1). A
  bounded value is a ceiling the source overshot, not a measurement, and 886 Water and 456 FIC
  values now read as exactly 100% because of it. The † mark and its footnote are what make these
  columns publishable.
- **No indicator averages, deliberately.** A mark travels with one rendered value; it cannot
  survive a mean or a median. An average water figure would absorb 886 ceilings and report
  near-universal coverage the source does not support.
- **Two cases render as "no verdict" rather than a result:**
  - *No provincial figure* — 57 barangays whose province supplied none. Criterion (d) is not
    evaluable there, which is not the same as passing it.
  - *A benchmark above the indicator's own maximum* — FIC's provincial reference was left uncapped
    in 2 provinces (Ilocos Sur 102.15, City of Butuan 101.00) while every barangay FIC was capped
    at 100. No barangay there can match it, so "worse than province" would be true by construction.
    **113 barangays**; `comparesWorse` returns null and the UI shows the benchmark with no verdict.
    This turns the cleaning report's §6 caveat into behaviour instead of a footnote.

## Data model

- Table **`fact_uuc_phc_barangay`** — one row per listed barangay: resolved `geo_code`,
  `source_geo_code` as the workbook supplies it, and the source's own region/province/citymun/
  barangay names for provenance. Public-read.
- Table **`fact_uuc_phc_indicators`** — one row per listed barangay: 12 indicators, the 7
  provincial benchmarks criterion (d) compares against, and `capped_indicators` (a `text[]` naming
  which of that barangay's values were bounded). Columns are unconstrained `numeric`, not
  `numeric(p,2)`: 15 source values carry three decimals and a scale of 2 would round them at
  insert. Public-read.
- View **`ref_uuc_phc_provincial`** — the benchmarks one row per province (**87**, not the source's
  88: two of its name-groups are both Zamboanga City). Derived from the fact table, keyed on
  `dim_geo.province_code` rather than the source's province names, 9 of which do not match
  `dim_geo`. `n_with_reference` against `n_listed_barangays` exposes partial coverage — in province
  `09317` only 1 of 8 listed barangays carries a reference, and a bare `max()` would have reported
  that single value as the whole province's benchmark.
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

## Registry and lineage (U5)

All four relations are described in `dataset_registry` / `dataset_column` and restated as nodes and
edges in `kb_node` / `kb_edge`.

- **The dictionary is the allowlist.** `queryDataset` (`lib/ai/query-dataset.ts`) refuses any
  relation with no approved dictionary and enforces `is_queryable` per column, so the registry — not
  a new hand-written tool — is what makes this dataset reachable by the assistant. Column
  `meaning` is the only text a model sees before composing a query, which is why the capping caveat
  is repeated on `capped_indicators` *and* on each of the seven indicators that can be bounded,
  while the seven `*_prov_ref` columns state the opposite ("never capped").
- **`ref_uuc_phc_provincial` is registered although it is a view**, because PostgREST and
  `queryDataset` both reach it exactly as they reach a table.
- **The view runs `security_invoker = true`.** The underlying fact table's public-read policy
  grants access; the view adds no privilege of its own. This closed an ERROR-level
  `security_definer_view` advisor finding and is the convention for any future view here.
- **Lineage is generated, never hand-written.** `ingestion/build_kb_lineage.py` reads the
  migrations, the ingestion scripts and the registry seed; it also reads `create view` and an
  explicit `-- lineage: <src> <relation> <dst>` directive, which is how
  `fact_uuc_phc_indicators derived-from docs/UUC_PHC_2025_CLEANING_REPORT.md` is asserted — a real
  derivation that no `from` or `join` states. Regenerate into a temp file and move it: redirecting
  onto the seed truncates a file the generator itself reads.
- `lib/db/dataset-registry-seed.test.ts` guards the seed, including the invariant that every
  registered relation has a `create table` or `create view` in `supabase/migrations`.

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
| Indicator read layer + comparison | `lib/db/uuc-phc-indicators.ts` (+ `.test.ts`) |
| Dataset slug | `lib/db/dataset.ts` (`DATASET_SLUGS.uucPhc`) |
| Section landing + sub-pages | `app/uuc-phc/` (`page.tsx`, `[geoLevel]/[geoCode]/page.tsx`, `methodology/`, `layout.tsx`) |
| Section components | `components/uuc-phc/` (coverage-hero, share-bar, child-breakdown, barangay-list, barangay-detail) |
| PNG one-pager | `lib/exports/uuc-phc-figure.ts` (+ `.test.ts`) + `app/api/export/uuc-phc/route.ts` |
| Fact loader | `ingestion/ingest_uuc_phc.py` |
| Cleaning step | `ingestion/clean_uuc_phc_indicators.py` |
| Source data | `ingestion/data/uuc_phc_2025_cleaned.csv` |
| Registry seed + its guard | `supabase/migrations/20260826090100_seed_dataset_registry.sql`, `lib/db/dataset-registry-seed.test.ts` |
| Lineage generator + seed | `ingestion/build_kb_lineage.py`, `supabase/migrations/20260826120100_seed_kb_lineage.sql` |
| Plan + provenance | `docs/UUC_PHC_2025_PLAN.md`, `docs/UUC_PHC_2025_CLEANING_REPORT.md` |

## Verification

- Aggregate: **1,788 rows**; national 5,991 of 41,958; sum of regions = sum of provinces = sum of
  citymuns = **5,991**; every province equals the sum of its citymuns and every region the sum of
  its provinces (**0 mismatches**); no area has `n_listed > n_barangays`; exactly **1 region (NCR)**
  reads zero.
- Regional counts reproduce the source workbook's own table at **all 17 regions** — see
  `docs/UUC_PHC_2025_PLAN.md` §4 for why Sulu's placement decides this.
- Share math unit-tested in `lib/db/uuc-phc.test.ts`, including the zero-denominator and
  "none listed" cases that must not collapse into each other. Indicator comparison logic in
  `lib/db/uuc-phc-indicators.test.ts` (13 tests): per-indicator direction, the null-not-false
  answer when a benchmark is missing, the impossible-benchmark rule, and criterion (b)'s summed
  conflict/displacement.
- Indicators: 5,991 rows; 1,397 barangays carry a capped flag totalling 1,584 values, matching the
  cleaning report per indicator; `physical_factor` never below the AO's floor of 25; no coverage
  value above 100 and no rate above 1,000; every listed barangay has an indicator row. All 5,991
  rows × 21 fields were read back from the database and compared to the committed CSV as decimals
  — **0 mismatches**.
- Routes verified against live data: `/uuc-phc` (5,991 / 41,958 / 14%, regions ranked with CAR at
  52%), `/uuc-phc/region/14`, `/uuc-phc/province/14027` (11 cities ranked by share),
  `/uuc-phc/citymun/1402706` (MAYOYAO, 27 of 27, all named), `/uuc-phc/citymun/0102804` (BANGUI,
  2 of 14, both groups named), `/uuc-phc/region/13` (NCR, 0 of 1,675 with the "result, not missing
  data" note), `/uuc-phc/methodology`. Unknown geos and `/uuc-phc/barangay/*` 404.
- Indicator rendering checked live: BACSIL (Bangui) shows its factors and a correctly-directional
  comparison; BITONG (Galimuyod, Ilocos Sur) shows two † marks with the footnote and its FIC as
  "not comparable — province reads 102.2" rather than a false "worse than province".
- Registry and lineage (U5): the four relations return from `dataset_registry` as
  `approved`/`public` with 8 / 6 / 24 / 10 approved columns, hash-matching the committed seed field
  for field; **no table node in `kb_node` lacks a `built-by` edge** and the generator prints nothing
  to stderr; `get_advisors` reports no `security_definer_view`; `anon` still reads all 87 rows of
  `ref_uuc_phc_provincial` over PostgREST.
- PNG export rendered and **visually inspected** at every level: national (18 regions, CAR first at
  52%), region, province, MAYOYAO and BANGUI (barangays named), NCR (0 of 1,675 with its note and
  an empty bar), and CEBU — 50 cities, where the 42-row cap prints "+ 8 more with a lower share,
  0 listed barangays between them" rather than truncating silently. 400 on bad parameters, 404 on
  an unknown geo.
