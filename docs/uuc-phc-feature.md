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
- **Indicators are never averaged** (U3). A capped value carries a † marker, and a marker cannot
  survive a mean. U3 honoured that by rendering them at barangay grain only; U9 added the other
  rendering that keeps a bounded value visible — a distribution. See "The indicators" and "The
  indicator distributions" below.
- **A PNG one-pager per area** (U4), reusing the profiling-status export machinery. It carries the
  count, the two-state split and the child table — **but no indicator values**: a one-pager cannot
  carry the † marker's footnote, and reproducing bounded values without it is exactly the unmarked
  artefact U3 was built to avoid.
- **All nine relations are registered and queryable by the internal assistant** (U5, extended by
  U7, U9 and U10). The column dictionaries are the allowlist `queryDataset` enforces, not documentation:
  `capped_indicators` and each of the seven boundable indicators carry the capping caveat in the
  column meaning itself, because that is what travels with a returned value. `agg_uuc_phc_criteria`
  carries the overlap warning the same way — on the table *and* on each of the four route columns,
  since adding them is the one thing a reader of those columns must not do.
- **Present mode on every page of the section** (U6), with the section's own name in the slide chrome. The
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
  The chat reaches only this dataset's own relations plus `dim_geo`/`dim_dataset`, and it refuses
  the question this list attracts: *should my barangay be on it?* See "Asking the list" below.
- **The indicators are published above barangay grain as distributions, never as averages** (U9).
  A mean absorbs the 1,584 bounded values into a figure the source does not support; a histogram
  leaves each value where it is and counts the bounded ones in the top bin. See "The indicator
  distributions" below.
- **What is wrong with the data is published beside it** (U10). `/uuc-phc/data-quality` renders
  the cleaning report's §6 as a surface, with every figure recomputed on each read rather than
  written down — a stale data-quality page is worse than none, because it is read as an assurance.
  See "Data quality" below.
- **Not built yet:** downloads, and the `/explore` overlay. Planned as U11–U12 in
  `docs/UUC_PHC_2025_PLAN.md` §9.

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
- **Three cases render as "no verdict" rather than a result:**
  - *No provincial figure* — 57 barangays whose province supplied none. Criterion (d) is not
    evaluable there, which is not the same as passing it.
  - *A placeholder benchmark set* — 226 barangays in 5 provinces whose references are every value
    1, or 0, or a fraction. These compare perfectly well and mean nothing, so `comparesWorse`
    cannot catch them; `benchmarksArePlaceholder` does, and the disclosure reads "no usable
    provincial figure". **Added in U9**, which is when this surface stopped disagreeing with the
    criteria page about the same barangay.
  - *A benchmark above the indicator's own maximum* — FIC's provincial reference was left uncapped
    in 2 provinces (Ilocos Sur 102.15, City of Butuan 100.96) while every barangay FIC was capped
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

## The indicator distributions (U9)

`/uuc-phc/indicators` (and `/uuc-phc/indicators/<level>/<code>`) publishes all 12 indicators above
barangay grain, at every level from national to city/municipality, as **ten equal-width bins each**
rather than as any summary figure.

- **A distribution is not a mean, and that is what makes this publishable.** U3 refused indicator
  aggregates because a † marker travels with one rendered value and cannot survive an average. The
  rule was *mark the value, never average it* — and a histogram averages nothing: every value stays
  at its own position, and the bounded ones pile up in the top bin where `bin_capped` counts them
  and the page draws them hatched. That pile-up is the most important thing this dataset says about
  itself, and a mean is exactly the rendering that hides it. **The page states the refusal in a
  line of its own**, because building this without saying why there is no average would re-open the
  hole U3 closed.
- **Equal-width bins, over the indicator's own domain** — 0–100 for the nine coverage percentages,
  0–1,000 for the three rates. IMR, UFMR and ABR are strongly zero-inflated (5,401 of 5,991
  barangays record an IMR of exactly 0), so narrow bins near zero and wide ones above would render
  a spike as a spread. Unequal bins misstate density by construction; the honest picture of a spike
  is a spike.
- **The top bin closes inclusive**, which is what puts an exactly-capped value inside it — so "the
  capped values are all in the top bar" holds by construction rather than by inspection, and the
  migration asserts it.
- **The provincial benchmark is drawn only where a single one exists** — province and
  city/municipality rows of the seven health indicators. A region or the nation spans 87 different
  benchmarks, which the page says once for the whole health group rather than under each of seven
  charts. Where a benchmark exists and is still not drawn, the page says which of three reasons
  applies, because they are different statements: **unreachable** (Ilocos Sur's FIC 102.15 and City
  of Butuan's 100.96, against barangay values capped at 100), **placeholder** (Agusan del Sur's
  every-value-1 set, Cagayan's zeroes, the Special Geographic Area's fractions), or **missing**
  (Nueva Vizcaya, Zamboanga City).
- **Worse-than-province is a count, never a share.** Evaluable denominators differ between areas
  for data-quality reasons, so a percentage would invite comparisons across areas the data cannot
  carry. The excluded count is stated beside it.
- **The placeholder rule now has one copy, not two.** U7 excluded those 226 barangays from route
  (d)'s denominator; `toBarangayDetail` did not, so a city page could print "worse than province
  (1)" for a barangay the criteria page had already excluded. `benchmarksArePlaceholder`
  (`lib/db/uuc-phc-indicators.ts`) is the rule, and the per-barangay disclosure, the criteria
  aggregate and the distributions all read it. The disclosure now shows "no usable provincial
  figure" and one sentence saying why.
- **`n_missing` is real and small.** The source left `ip_pop` blank for 17 barangays, `armed_conf`
  for 42 and `idp` for 47; the other nine indicators are complete. The bars plus `n_missing` equal
  the area's listed count — asserted in the migration, because a histogram whose bars do not
  account for every barangay is a histogram of an unstated subset.
- **An area with nothing listed gets an empty state, not twelve empty axes.** NCR's 12 rows are
  real zeroes, and the page reads `agg_uuc_phc_counts` alongside the distributions so a transient
  read failure renders as "unavailable" rather than as "no unserved barangays here".

## Data quality (U10)

`/uuc-phc/data-quality` renders `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 — the most important
thing written about this dataset, and until U10 invisible to anyone using it. Four sections: what
was bounded, where the criterion (d) comparison cannot be made, how the list stands against the
published total, and what remains unresolved.

- **Every figure is computed, and none is typed.** That decides the shape of everything behind the
  page. A hand-written "1,584" drifts the first time the extract is regenerated, and a stale
  data-quality page is worse than none because it is read as an assurance. So the two new relations
  are **views** — they cannot go stale against the fact table they read — and the one new table is
  re-derived by its own migration rather than seeded.
- **Three of the four sections needed no new object at all.** Per-indicator capping comes from
  `agg_uuc_phc_indicator_dist`'s national rows (U9); the count of barangays criterion (d) cannot be
  evaluated for comes from `agg_uuc_phc_criteria` (U7). What U10 added is what those cannot say.
- **1,397 barangays, not 1,584 values.** 167 barangays carry more than one bounded value, so the
  two counts differ and no per-indicator aggregate can count a barangay once. Presenting the value
  count as a barangay count overstates the affected share of the list by about 13%, which is why
  `ref_uuc_phc_quality` exists at all and why both column dictionaries say so.
- **Four reasons a benchmark is unusable, kept apart.** "No reference supplied", "every value
  zero", "every value exactly 1" and "fractions where percentages were wanted" are four different
  things for the source office to fix, and a page that collapses them into "unusable" throws away
  the part they would act on. The kinds are computed from the values, never from a list of province
  codes.
- **The two benchmark findings are never added together.** 226 barangays cannot support criterion
  (d) at all; a different 113 are affected on the FIC comparison alone and remain evaluable on the
  other six indicators. Summing them to 339 would be wrong in both directions at once, so the view
  carries a `finding` column and the page renders two tables.
- **The published-total reconciliation is parsed, not transcribed.** Cue cards p37 is loaded in
  `doc_chunk`, so the migration reads all 17 of its regional figures out of the chunk, checks they
  resolve to `dim_geo` and sum to its own printed TOTAL, and stores only the geographies that
  differ. *Which* regions differ is therefore a finding rather than a pair chosen by hand — and a
  typo in a hand-copied 400 would have been indistinguishable from a real discrepancy.
- **Only the differing rows are stored, deliberately.** `doc_source` marks the cue cards
  `exposure = 'internal'`; plan §3 records the owner approving publication of the *reconciliation*,
  and U10 asks for the two affected regions. p37's other 15 rows match to the unit and carry no
  reconciliation, so storing them would republish an internal document's table for nothing. The
  migration still checks all 17.
- **A table, not a view, for that one relation** — `doc_source` and `doc_chunk` are service-role
  only, so a `security_invoker` view over them would read as empty for the caller the page runs as.
  Parsing once into a public-read table is what makes the figure reachable.
- **The vintage reading is rendered as inference.** A vintage gap is the likeliest explanation of
  the +4 and neither document states it, so the page prints the two figures, their dates and where
  the gap sits — and says in as many words that why they differ is not recorded.
- **The criterion (d) recomputation is performed on purpose, to measure itself.** This is the one
  place the derivation `fact_uuc_phc_indicators.health_indicators` warns against is actually run.
  It disagrees on 664 of 5,991 barangays, always lower, and would leave 98 listed barangays
  qualifying on no route at all — which the AO makes impossible. That pair is the evidence for
  loading the score rather than deriving it, and showing it beats asserting it.
- **An empty page must never read as a clean bill of health.** A failed read renders an explicit
  "not available right now — that is a failure to load, not a finding that there is nothing to
  report", because silence on this page is the one message it cannot afford to send by accident.

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
- Table **`agg_uuc_phc_indicator_dist`** (U9) — public-read aggregate keyed `(dataset_id, geo_code,
  geo_level, indicator)` at the same four levels × 12 indicators, **21,456 rows**. Per row:
  `value_max`, `n_listed`, `bin_counts` and `bin_capped` (fixed-length `integer[10]`, enforced by a
  check constraint), `n_missing`, `provincial_ref`, `n_comparable` and `n_worse`.
  - **The bins are an array, not ten rows.** They are a fixed-length ordered vector that every
    consumer wants whole — the read granularity is exactly one row per chart on the page — and the
    long form would be 214,560 rows to answer the same question.
  - **Whether the benchmark may be drawn is derived, not stored.** `provincial_ref` against
    `value_max` gives the unreachable case and `n_comparable = 0` with a benchmark present gives the
    placeholder case, both from rules that already exist elsewhere. A stored "usable" flag would be
    a third copy of a two-copy rule, and the one most likely to drift.
  - **Computed in SQL from `fact_uuc_phc_indicators` + `agg_uuc_phc_counts` + `dim_geo`**, on the
    same precedent as the other two aggregates: re-running the migration recomputes every row, and
    that *is* the refresh procedure.
  - Eight assertions run after the load: every geo carries all 12 indicators and agrees with
    `agg_uuc_phc_counts.n_listed`; bins plus `n_missing` equal `n_listed`; capped counts sit inside
    their bin and only in the top bin; the national capped totals match
    `fact_uuc_phc_indicators.capped_indicators` per indicator; comparison counts nest inside their
    denominators and are zero on the five indicators criterion (d) does not test; no benchmark
    above province level; `n_comparable` agrees with `agg_uuc_phc_criteria.n_health_evaluable` on
    the six health indicators FIC's extra exclusion does not touch; every level rolls up to the
    national totals per indicator.
- View **`ref_uuc_phc_quality`** (U10) — one row: the national data-quality facts no per-indicator
  aggregate can express. `n_barangays_capped` (1,397) against `n_values_capped` (1,584) and
  `n_barangays_multi_capped` (167); plus the criterion (d) recomputation's disagreement (664) and
  the 98 barangays it would leave routeless. `security_invoker`, and a view rather than a table
  precisely so it cannot go stale.
- View **`ref_uuc_phc_benchmark_gaps`** (U10) — one row per province with a benchmark finding,
  **7 rows**: 5 whose whole set cannot carry criterion (d) (`finding = 'criterion_d'`, 226
  barangays) and 2 whose FIC benchmark exceeds the ceiling barangay values were bounded to
  (`finding = 'fic_only'`, 113 barangays). `n_affected` is barangays and is not always the
  province's whole list — province 09317 has 7 of 8. `security_invoker`.
- Table **`ref_uuc_phc_published_delta`** (U10) — **3 rows**: the national total and the two regions
  where cue cards p37 differs from this dashboard. A table rather than a view because `doc_chunk` is
  service-role only. Rows that stop differing are deleted on re-run, so a corrected source empties
  the table rather than leaving a closed gap on the page.
- Column **`fact_uuc_phc_indicators.health_indicators`** (U7) — the source's criterion (d) score,
  0–7, loaded as supplied and *not* recomputable from the columns beside it. See "The qualifying
  routes" above.
- The **share** is derived in the read layer (`lib/db/uuc-phc.ts`), not stored — one definition,
  one place, the same discipline as the profiling-status stage totals.
- Dataset row in `dim_dataset` (`uuc-phc-2025`, `geo_join_level = 'barangay'`, status `published`).

## Registry and lineage (U5, extended by U7, U9 and U10)

All nine relations are described in `dataset_registry` / `dataset_column` and restated as nodes and
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
3. Re-run the aggregate blocks of `20260826140000_agg_uuc_phc_counts.sql`,
   `20260827100000_agg_uuc_phc_criteria.sql`, `20260827160000_agg_uuc_phc_indicator_dist.sql` and
   `20260827170000_uuc_phc_data_quality.sql`, in that order. All four recompute from the fact
   tables, so they need no regeneration — only re-execution, after the fact seed. Each reads the
   one before it, which is what fixes the order.

   The data-quality page needs no step of its own beyond that: its two views recompute on every
   read, and only `ref_uuc_phc_published_delta` is stored — re-running its migration re-parses cue
   cards p37 and deletes any geography that has stopped differing, so a corrected source empties
   the table rather than leaving a closed gap on the page.

The loader refuses to emit on a failed check (row count, PSGC format, duplicates, `UUA`-only, the
87-code Sulu count, all 17 regional counts): a silently short load is worse than a failed one when
5,991 is a headline figure.

## Key files

| Area | Path |
| --- | --- |
| Read layer + share helper | `lib/db/uuc-phc.ts` (+ `.test.ts`) |
| Indicator read layer + comparison | `lib/db/uuc-phc-indicators.ts` (+ `.test.ts`) |
| Distribution read layer + bins | `lib/db/uuc-phc-indicator-dist.ts` (+ `.test.ts`) |
| Dataset slug | `lib/db/dataset.ts` (`DATASET_SLUGS.uucPhc`) |
| Section landing + sub-pages | `app/uuc-phc/` (`page.tsx`, `[geoLevel]/[geoCode]/page.tsx`, `methodology/`, `layout.tsx`) |
| Section components | `components/uuc-phc/` (coverage-hero, share-bar, child-breakdown, barangay-list, barangay-detail) |
| Grounding scopes (chat + narrative) | `lib/ai/dataset-scope.ts` (+ `.test.ts`), `lib/ai/scope-id.ts` |
| UUC system prompt | `lib/ai/uuc-phc-system-prompt.ts` |
| Section chat launcher | `components/uuc-phc/ask-the-list.tsx` → `components/chat/chat-launcher.tsx` |
| Chat route + its tests | `app/api/ai/chat/route.ts` (+ `.test.ts`) |
| Dataset-scoped registry reads | `lib/db/dataset-registry.ts` (+ `dataset-registry-scope.test.ts`) |
| Ask-cache dataset column | `supabase/migrations/20260827150000_ai_ask_cache_dataset_slug.sql` |
| Criteria read layer | `lib/db/uuc-phc-criteria.ts` (+ `.test.ts`) |
| Criteria page + components | `app/uuc-phc/criteria/`, `components/uuc-phc/` (criteria-section, route-shares, route-not-evaluable, route-breakdown) |
| Indicators page + components | `app/uuc-phc/indicators/`, `components/uuc-phc/` (indicators-section, indicator-histogram) |
| Distribution aggregate | `supabase/migrations/20260827160000_agg_uuc_phc_indicator_dist.sql` |
| Data-quality read layer | `lib/db/uuc-phc-quality.ts` |
| Data-quality page + components | `app/uuc-phc/data-quality/`, `components/uuc-phc/` (quality-sections, quality-format + `.test.ts`) |
| Data-quality relations | `supabase/migrations/20260827170000_uuc_phc_data_quality.sql` |
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
  `lib/db/uuc-phc-indicators.test.ts` (19 tests): per-indicator direction, the null-not-false
  answer when a benchmark is missing, the impossible-benchmark rule, the placeholder-benchmark rule
  and its three real shapes, and criterion (b)'s summed conflict/displacement. Bin and
  benchmark-state logic in `lib/db/uuc-phc-indicator-dist.test.ts` (16 tests), including that the
  bars scale to the tallest bin rather than to the area's list and that the five reasons a
  benchmark is not drawn stay distinct.
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
- Indicator distributions (U9): `agg_uuc_phc_indicator_dist` is **21,456 rows** (1,788 geos × 12
  indicators); all **eight** in-migration assertions pass. The national row's bins reproduce a
  direct `floor(value / width)` count over `fact_uuc_phc_indicators` for every indicator, and the
  capped totals per indicator are exactly the cleaning report's (Water 886, FIC 456, Pre-natal 208,
  SBA 30, ABR 2, IMR 1, UFMR 1) — **all in the top bin, none anywhere else**. `n_missing` is 17 /
  42 / 47 for `ip_pop` / `armed_conf` / `idp` and 0 for the other nine; bins plus `n_missing` equal
  5,991 on all twelve. `n_comparable` is 5,765 on six health indicators and 5,652 on FIC (the extra
  113), matching `agg_uuc_phc_criteria.n_health_evaluable` row for row. `physical_factor`'s two
  lowest bins are empty, which is the AO's 25% floor showing up as a shape. In Chromium at
  national, Ilocos Sur, Agusan del Sur, City of Butuan (province and citymun) and NCR: **the FIC
  benchmark line is absent in both Ilocos Sur and City of Butuan** with the reason printed, absent
  in Agusan del Sur as a placeholder set, drawn at 71.3% for Ilocos Sur's Water and 88.1% for
  Butuan's; the hatched capped segment renders at the top of every affected top bar with its
  legend and count; NCR shows the empty state rather than twelve empty axes; the deck starts,
  advances through Title / The physical factor / Socio-economic factors / Health indicators /
  Closing and exits on Esc; `/uuc-phc/indicators/barangay/*` 404s. **No mean, median or other
  summary statistic appears in the DOM** on any of them, and there are **zero console errors** on
  the production build. Driven against `next start`, not `next dev`, so the root layout's
  dev-only theme-attribute hydration warning — which reproduces identically on `/uuc-phc` and
  `/uuc-phc/criteria` — is out of the picture.
- Data quality (U10): all seven in-migration assertion groups pass. `ref_uuc_phc_quality` returns
  **1,397 / 1,584 / 167** and **664 / 98 / 0**, matching the cleaning report and
  `docs/UUC_PHC_2025_PLAN.md` §1a exactly; `n_values_capped` equals the sum of
  `agg_uuc_phc_indicator_dist`'s national `bin_capped`. `ref_uuc_phc_benchmark_gaps` returns 7 rows
  totalling **226** (`criterion_d`, matching `agg_uuc_phc_criteria.n_health_evaluable` row for row)
  and **113** (`fic_only`, matching the province rows with `provincial_ref > value_max`), with
  Zamboanga City correctly reading **7 of 8**. The p37 parse reads **17 region rows summing to
  5,987 = its own TOTAL**, all 17 resolving to `dim_geo`, and the one region it does not print is
  NCR — which has nothing listed. `ref_uuc_phc_published_delta` holds exactly **3 discovered rows**:
  PH +4, CALABARZON +5, BARMM −1.

  Rendered and read at `/uuc-phc/data-quality`: the bounded table prints the cleaning report's own
  per-indicator counts and shares (Water 886 = 14.8%, FIC 456 = 7.6%), the three single-value rows
  read **`<0.1%`** rather than `0%`, and the two FIC benchmarks print at full precision
  (**102.15%** and **100.96%**) rather than rounding Butuan's back to the 101.00 U9 corrected. No
  new advisor finding: both views are `security_invoker`, so neither raises `security_definer_view`.
  The methodology page's five typed counts are gone, replaced by links here.
- PNG export rendered and **visually inspected** at every level: national (18 regions, CAR first at
  52%), region, province, MAYOYAO and BANGUI (barangays named), NCR (0 of 1,675 with its note and
  an empty bar), and CEBU — 50 cities, where the 42-row cap prints "+ 8 more with a lower share,
  0 listed barangays between them" rather than truncating silently. 400 on bad parameters, 404 on
  an unknown geo.
