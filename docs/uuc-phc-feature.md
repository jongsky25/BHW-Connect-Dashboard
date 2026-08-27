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
- **All five relations are registered and queryable by the internal assistant** (U5, extended by
  U7). The column dictionaries are the allowlist `queryDataset` enforces, not documentation:
  `capped_indicators` and each of the seven boundable indicators carry the capping caveat in the
  column meaning itself, because that is what travels with a returned value. `agg_uuc_phc_criteria`
  carries the overlap warning the same way — on the table *and* on each of the four route columns,
  since adding them is the one thing a reader of those columns must not do.
- **Present mode on both pages** (U6), with the section's own name in the slide chrome. The
  barangay list is one slide rather than one per barangay: its indicator disclosures stay closed
  on promotion, so a capped value cannot reach a projected screen without its † footnote.
- **Corrections are routed, not just collected** (U6). `feedback.dataset_slug` is derived from the
  page path at write time, and the section footer asks the question this list actually attracts —
  "Is a barangay missing from this list, or listed in error?" — while saying plainly that the list
  is DOH's to change, not ours.
- **Why each barangay qualified, above barangay grain** (U7). `/uuc-phc/criteria` counts the four
  socio-economic routes per area. The routes **overlap**, so they render as four independent
  shares against their own denominators — never stacked, never a pie, and the page prints the
  sum (146% nationally) to say so in words rather than let a reader infer a partition.
- **Ask the data, scoped to this list** (U8). The chat and the AI insight slot both run on a
  grounding scope that carries this dataset's slug, prompt, tools and cache version together — the
  two caches previously keyed on the BHW census's version and would have served its answers here.
  The chat reaches only this dataset's five relations plus `dim_geo`/`dim_dataset`, and it refuses
  the question this list attracts: *should my barangay be on it?* See "Asking the list" below.
- **Not built yet:** an `/explore` overlay, and the sub-pages that would show the indicator
  distributions and the data-quality caveats above barangay grain. Planned as U9–U12 in
  `docs/UUC_PHC_2025_PLAN.md` §8–§9.

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

## The qualifying routes (U7)

`/uuc-phc/criteria` (and `/uuc-phc/criteria/<level>/<code>`) answers *why* the barangays in an area
are on the list: how many came in on each of the four socio-economic routes of AO §VI.A. The
physical factor is not counted — it holds in all 5,991 rows by construction, since a barangay below
the 25% floor never entered the list.

- **The four routes overlap and do not partition the list.** A barangay can qualify on three at
  once; nationally the four shares come to 146%. So the page draws four independent 0–100% tracks,
  each labelled with its own denominator, and states the sum in a sentence. A stacked bar or a pie
  would assert four slices of one whole, which is not the shape of the data. There is no "other"
  or remainder figure, because there is no remainder.
- **Route (d) has a different denominator from the other three.** For **226** barangays in 5
  provinces the provincial benchmark cannot support the comparison at all, so they are excluded
  from the health route's denominator and the page says which and why. Giving all four routes the
  same denominator would understate exactly the route whose evidence is weakest. Where the
  comparison is evaluable for nobody the page reads **"Not evaluable here"**, never "0%" — Agusan
  del Sur, all 156 of its listed barangays.
- **226, not the 238** that `UUC_PHC_2025_PLAN.md` §1a and `UUC_PHC_2025_CLEANING_REPORT.md` §6
  both stated. Their per-province tables always summed to 226; the total was an addition error.
  Corrected in both, and the page computes the figure rather than quoting it.
- **The health route counts the source's own score, not a recomputation.** `health_indicators` (0–7)
  is the source office's criterion (d) result and is loaded as supplied. Deriving it from the
  published, capped columns disagrees on **664 rows** and leaves **98 listed barangays qualifying
  on no route at all** — impossible under the AO, which requires a socio-economic factor. So the
  recomputation is not the test that selected this list. Carrying the recorded classification is
  also what keeps this aggregate a count of *classifications*: it never averages a bounded value,
  which is the reason U3's per-indicator aggregates were refused and this one is not.
- **The not-evaluable test is computed per barangay, not a list of province codes.** "The largest
  of this barangay's seven benchmarks is null, or at most 1" identifies a placeholder, a zero-fill
  or a fraction encoding, and selects exactly those 226. A province-level test would find only 219:
  `ref_uuc_phc_provincial` rolls Zamboanga City's 7 reference-less barangays in with the 1 that has
  a full set.
- **Children with nothing listed are dropped from this breakdown**, unlike the coverage one, where
  "0 of 1,675" is the finding. Here the row would be four empty tracks restating one zero.

## Asking the list (U8)

`ChatLauncher` runs on all four routes — the overview, the area pages and both criteria pages —
and `AiInsight` sits on the area pages. Both are grounded in this dataset alone.

- **The two AI caches had no dataset in their keys, and that is what U8 fixed first.** Both keyed
  on `getActiveDataset()`'s `last_updated_at`, i.e. the *BHW census's*, so the same words asked on
  `/uuc-phc` and `/bhw` computed the same key. The failure is invisible: a cross-dataset hit is
  fluent, names a real place, and passes the numeric audit, because it *is* grounded — in the other
  dataset. `narrative_type` gained `'uuc_overview'` (it was already in the key, so this cost one
  enum value); `askCacheKey` gained the dataset slug; `ai_ask_cache.dataset_slug` and a `dataset`
  argument to `match_ask_answer` close the near-match path, which never reads the cache key at all;
  and `refreshApprovedAskAnswers` now walks one dataset scope at a time, since regenerating a UUC
  question under the BHW prompt would write a wrong-dataset answer back at `approved`.
- **One scope object, not four settings** (`lib/ai/dataset-scope.ts`). Dataset slug, system prompt,
  tool set, narrative type and empty-answer line travel together, because the failure worth
  preventing is a *partial* switch — the right tools with the wrong prompt still produces a fluent,
  audited, wrong-dataset answer. The BHW scope is the pre-U8 behaviour verbatim, so `/bhw`,
  `/place/*` and `/explore` are unchanged by construction.
- **The tool set is this dataset's, not everything public.** `createDatasetTools('public')` would
  hand over all 26 public relations. Nothing unsafe — `anon` reads them all — but it would make the
  two sections answer each other's questions by construction. Scoped to `uuc-phc-2025`, the chat
  sees seven relations: the five UUC ones plus `dim_geo` and `dim_dataset`, which carry no dataset
  slug because they are the coordinate system, not a dataset. `dim_geo` is what lets an answer tell
  **"not on the 2025 list"** apart from **"there is no such barangay"**.
- **Refusals are the point of the increment.** Presence is recorded; the assessment behind it is
  not, and the barangays assessed and *not* listed were never loaded. So the chat can say whether a
  barangay is listed and which recorded criteria its values meet, and it must never say whether one
  *should* be listed, why the source office included or excluded any barangay, or whether an
  unlisted barangay would qualify. It points at BLHSD and the footer's correction link instead.
  `/uuc-phc/methodology#ask` says the same thing to the reader — a refusal policy that lives only
  in a prompt is a policy nobody can read.
- **The section's caveats are prompt rules, not hopes.** `health_indicators` is reported as the
  source's recorded score and never as something checkable against `imr`/`fic`/`water`; a value
  named in `capped_indicators` is reported as a ceiling in the same sentence and the seven boundable
  columns are never averaged; the four routes are never added, and route (d)'s denominator is
  `n_health_evaluable`.
- **The model is told not to quote the order's thresholds**, because `auditNarrative` strips them:
  it collects numbers from tool payloads, and a number inside a dictionary string is not collected,
  so "at least 10 percent" is untraceable and its sentence is dropped. Widening the audit's
  allow-list was refused — it is shared with `/bhw`. Pointing at the methodology page is the fix.
- **`ChatLauncher`'s BHW copy is props**, defaulted to the BHW values on `DeckMeta.brandLabel`'s
  discipline. `components/uuc-phc/ask-the-list.tsx` binds this section's starters, intro,
  placeholder and methodology link once.
- **Two wrong figures were found in the column dictionaries and fixed**: `ref_uuc_phc_provincial`
  still said 238 barangays cannot support criterion (d) (U7 established 226), and
  `agg_uuc_phc_criteria` said the routes come to "about 141 percent" where the live row gives 146 —
  the figure the criteria page prints. The dictionary is what a model reads before composing a
  query, so a stale number there reaches an answer with nothing rendering it for a person to catch.
  Every other figure in the five UUC dictionaries was checked against live data and is correct.

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
- Table **`agg_uuc_phc_criteria`** — public-read aggregate keyed `(dataset_id, geo_code,
  geo_level)` at the same four levels, **1,788 rows**. `n_listed` plus four route counts, plus
  `n_health_evaluable` (route (d)'s denominator). The excluded count is derived in the read layer
  as `n_listed - n_health_evaluable`, not stored.
  - **Computed in SQL from `fact_uuc_phc_indicators` + `dim_geo`**, on `agg_uuc_phc_counts`'
    precedent: re-running the migration recomputes every row, and that *is* the refresh procedure.
  - Four assertions run after the load and abort the migration rather than publish a wrong share:
    `n_listed` agrees with `agg_uuc_phc_counts` on every row (they are computed from different fact
    tables, so this also checks that the two tables cover the same 5,991 barangays); every criteria
    row has a counts row; no route count exceeds its denominator; every level rolls up to the
    national totals.
- Column **`fact_uuc_phc_indicators.health_indicators`** (U7) — the source's criterion (d) score,
  0–7, loaded as supplied and *not* recomputable from the columns beside it. See "The qualifying
  routes" above.
- The **share** is derived in the read layer (`lib/db/uuc-phc.ts`), not stored — one definition,
  one place, the same discipline as the profiling-status stage totals.
- Dataset row in `dim_dataset` (`uuc-phc-2025`, `geo_join_level = 'barangay'`, status `published`).

## Registry and lineage (U5, extended by U7)

All five relations are described in `dataset_registry` / `dataset_column` and restated as nodes and
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

## Section chrome (U6)

- **Present mode** wraps both pages (`PresentationProvider`), with `PresentButton` beside each
  page's `<h1>` — it has to live inside the provider, and the provider needs page-specific
  `DeckMeta`. Slides: the coverage card, the child breakdown, and at city/municipality the
  barangay list.
- **`DeckMeta.brandLabel`** is the shared-machinery fix behind it. `PresentationSlide` and
  `PresentationDeck` printed the literal `BHW Connect`; the field is optional and defaults to it,
  so `/bhw`, `/place/*`, `/explore` and `/compare` are unchanged, and this section passes
  `"UUC for PHC"`. `/profiling-status` can adopt the same field with a one-line change.
  Resolution is `brandLabelOf` in `components/present/deck-logic.ts`, unit-tested.
- **The deck caption's N is the area's listed count**, not the national 5,991 — a deck presented on
  Mayoyao reads `N = 27 listed barangays · MAYOYAO · 2025 list (DC No. 2025-0549)`.
- **Feedback is dataset-aware.** `SpotFeedback` already rendered here; what was added is
  `feedback.dataset_slug`, derived server-side from `page_path` in `app/api/feedback/route.ts` via
  `lib/feedback/dataset.ts`, and the section-specific entry point in the footer
  (`components/uuc-phc/list-correction.tsx`). `/explore` and `/compare` stay null on purpose:
  they render several datasets, and a filterable wrong slug is worse than none.
- **Social cards** at both routes carry the count as the headline and no indicator values — a
  1200×630 card cannot hold the † footnote a capped value needs (U4's rule). A zero renders as a
  zero: NCR reads "0 of 1,675 barangays".

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
| Grounding scopes (chat + narrative) | `lib/ai/dataset-scope.ts` (+ `.test.ts`), `lib/ai/scope-id.ts` |
| UUC system prompt | `lib/ai/uuc-phc-system-prompt.ts` |
| Section chat launcher | `components/uuc-phc/ask-the-list.tsx` → `components/chat/chat-launcher.tsx` |
| Chat route + its tests | `app/api/ai/chat/route.ts` (+ `.test.ts`) |
| Dataset-scoped registry reads | `lib/db/dataset-registry.ts` (+ `dataset-registry-scope.test.ts`) |
| Ask-cache dataset column | `supabase/migrations/20260827110000_ai_ask_cache_dataset_slug.sql` |
| Criteria read layer | `lib/db/uuc-phc-criteria.ts` (+ `.test.ts`) |
| Criteria page + components | `app/uuc-phc/criteria/`, `components/uuc-phc/` (criteria-section, route-shares, route-not-evaluable, route-breakdown) |
| PNG one-pager | `lib/exports/uuc-phc-figure.ts` (+ `.test.ts`) + `app/api/export/uuc-phc/route.ts` |
| Fact loader | `ingestion/ingest_uuc_phc.py` |
| Cleaning step | `ingestion/clean_uuc_phc_indicators.py` |
| Source data | `ingestion/data/uuc_phc_2025_cleaned.csv` |
| Present mode wiring | `components/present/` (`deck-logic.ts` `brandLabelOf`), both `app/uuc-phc` pages |
| Correction entry point | `components/uuc-phc/list-correction.tsx` |
| Feedback dataset routing | `lib/feedback/dataset.ts` (+ `.test.ts`), `app/api/feedback/route.ts` |
| Social cards | `app/uuc-phc/opengraph-image.tsx`, `app/uuc-phc/[geoLevel]/[geoCode]/opengraph-image.tsx` |
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
- Registry and lineage (U5, U7): the five relations return from `dataset_registry` as
  `approved`/`public` with 8 / 6 / 25 / 10 / 10 approved columns, hash-matching the committed seed
  field for field; **no table node in `kb_node` lacks a `built-by` edge** and the generator prints nothing
  to stderr; `get_advisors` reports no `security_definer_view`; `anon` still reads all 87 rows of
  `ref_uuc_phc_provincial` over PostgREST.
- Section chrome (U6): the deck was driven end to end in a real browser on seven routes — the three
  UUC routes start, advance, show **"UUC FOR PHC"** in the slide header and exit; `/bhw`,
  `/place/*`, `/explore` and `/compare` all still read **"BHW Connect"**. Feedback from
  `/uuc-phc/citymun/1402706` landed with `dataset_slug = 'uuc-phc-2025'` and from `/explore` with
  null. OG images render 1200×630 at national, region (NCR's zero included), province and
  city/municipality, and were looked at rather than only status-checked. Exactly one `SpotFeedback`
  widget and one correction entry point on the page.
- Qualifying routes (U7): `agg_uuc_phc_criteria` is **1,788 rows** matching `agg_uuc_phc_counts`
  row for row on `n_listed`; all four in-migration assertions pass and **0 rows** carry a count
  outside its denominator. The national row equals a direct count over `fact_uuc_phc_indicators` on
  all six figures (5,991 / 3,677 / 2,302 / 726 / 2,000 / 5,765), which also match an independent
  computation over the committed CSV. 2,001 barangays score `health_indicators >= 4` and **2,000**
  of them are evaluable, so the national health route reads 2,000 — the exclusion is exactly the one
  row it should be. All 5,991 loaded scores were read back and compared to the committed CSV as
  `(source_geo_code, score)` pairs: **md5 match, 0 mismatches**. **672 of the 1,047** areas with
  anything listed have four shares summing above 100%. Rendered and looked at at national (146%),
  CARAGA (184%, 156 excluded), Agusan del Sur (all 156 excluded, "Not evaluable here"), Mayoyao
  (104%) and NCR (0 listed, empty state); the deck starts, advances and exits on the route;
  `/uuc-phc/criteria/barangay/*` and unknown geos 404.
- Ask the data (U8): the migration backfilled 10 `ai_ask_cache` and 36 `ai_ask_log` rows to
  `bhw-2025` with **0 nulls**; the one real `approved` row near-matches at **1.000** under
  `bhw-2025` and returns **no rows** under `uuc-phc-2025` at the same words, version and geo scope.
  The UUC scope resolves to exactly **7** relations and no BHW aggregate, and all five UUC
  `notes_md` hash-match the committed seed after the 238→226 and 141→146 corrections. The chat path
  was run end to end against live data with a **scripted model** in place of the provider (no
  provider key in this environment): `agg_bhw_counts` refused as "not registered for public use on
  this page", the national criteria row returned with its overlap caveat, a capped barangay
  returned with `capped_indicators` beside its values, a real NCR barangay resolved in `dim_geo` and
  counted **0** in the fact table, and a fabricated threshold sentence was stripped while the
  queried figure survived. In Chromium: all four UUC routes show the section's starters, intro,
  placeholder and `/uuc-phc/methodology#ask` link and POST `dataset: "uuc-phc"`; `/bhw` and
  `/explore` are unchanged; the deck still reads "UUC FOR PHC" over five slides and `/bhw`'s eight
  still read "BHW CONNECT"; **zero console errors**. A live model answering a real question is
  **not** verified — the surfaces degrade to "Live AI is at capacity right now", which was seen.
- PNG export rendered and **visually inspected** at every level: national (18 regions, CAR first at
  52%), region, province, MAYOYAO and BANGUI (barangays named), NCR (0 of 1,675 with its note and
  an empty bar), and CEBU — 50 cities, where the 42-row cap prints "+ 8 more with a lower share,
  0 listed barangays between them" rather than truncating silently. 400 on bad parameters, 404 on
  an unknown geo.
