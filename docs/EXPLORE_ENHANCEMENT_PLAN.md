# Explore Enhancement Plan — Phased Implementation (handoff document)

The committed implementation plan for `docs/EXPLORE_PAGE_REVIEW.md`'s recommendations, written for
an implementing agent starting fresh. Read the review first for the *why*; this document is the
*what and in what order*. Follow the working conventions in `BUILD_PLAN.md` §5 (engineering
standards) and the per-increment logging convention of `DECISIONS.md` (append an entry per
increment: what was built, what was decided, verify evidence).

**Status:** approved by the owner 2026-07-21. Phases ship in order; **Phase E0 ships alone as its
own release before E1 starts** (owner decision Q6). Within a phase, increments are ordered by
dependency; each increment is an independently shippable PR-sized unit.

## 0. Owner decisions (locked — do not relitigate)

| # | Question (review §12) | Decision |
|---|---|---|
| 1 | Explore identity | **Confirmed:** indicator-first analyst workbench. Place = place-first narrative, Home = national narrative, Compare = side-by-side. Every "where does this feature go?" question resolves against this. |
| 2 | Map indicator set v1 | **All six:** % accredited · any-honorarium % · households per BHW · avg years of service · profile coverage % · **per-topic training coverage** (topic picker included in v1). |
| 3 | External data | **Tier 1 bundle approved** (POPCEN 2024, CPH 2020, SAE 2021 poverty, DOF/BLGF 2024 income classes, PSGC crosswalk). **NHFR/FHSIS: use whatever is publicly available online, with citation** — no formal license conversation required before use; cite source + retrieval date in `/methodology` and `dim_dataset`. |
| 4 | `ROLE` column | **Approved for ingestion** as a demographic dimension, subject to the E3.1 data audit (cardinality/cleanliness gate below). |
| 5 | Time-cohort figures | **Approved** under "2025 snapshot" framing; captions state "years as recorded in the 2025 snapshot". |
| 6 | Sequencing | **P0 (Phase E0) ships first as its own release**, then P1 (Phase E1). |
| 7 | Adjusted rates (S2) | **Approved:** publish empirical-Bayes adjusted rates alongside raw, clearly labeled, methodology-documented, raw shown by default. |
| 8 | Composite measure (S9) | **Scorecard only** (per recommendation). No single composite index for now. |

## 1. Ground rules for every increment

- **Free tier only.** No new paid infrastructure; all statistics precomputed at ingestion/build
  time into `agg_*` tables (closed-form math in Python/SQL — no live computation endpoints).
- **Suppression:** derived stats inherit the n<5 discipline. Distribution-shaped outputs get
  `is_suppressed` handling like `agg_honorarium`. Facts stay RLS service-role-only; only
  aggregates publish.
- **Figure contract:** every new figure/stat uses `FigureCard` (Person/Place/Time caption, layman
  headline, collapsed technical details) and gets `GlossaryTerm` entries + a `/methodology`
  section when it introduces a method (bins, CI, adjustment, correlation, Gini…). A statistic
  that can't be explained in one plain sentence doesn't ship.
- **URL is the only state** for anything filterable (nuqs, `shallow: false`, `history: "push"`),
  extending `lib/filters/schema.ts` + `codec.ts` with parsers + tests like existing params.
- **Accessibility:** the map stays `aria-hidden` with the ranked list always rendered as the
  accessible equivalent (BUILD_PLAN §4.3). New interactive controls follow the axe-clean bar
  (a11y = 100 was achieved on this page; keep it).
- **Known pitfalls that WILL bite:** PostgREST 1,000-row hard cap (paginate any query that can
  exceed it — national→citymun is 1,639 geos; see DECISIONS 1.10); PSGC codes are fixed-width
  padded TEXT everywhere; NCR has known boundary gaps (grey polygons are expected, not bugs);
  barangay level has no `agg_training`/`agg_data_completeness` rows (fall back to citymun with a
  label, as `TrainingFigure` does).
- **Verify per increment:** `npm run lint && npm run typecheck && npm test && npm run build`,
  axe on affected page states, and the increment-specific checks listed below. Log to
  `DECISIONS.md`.

---

## Phase E0 — Map trust (ships alone, first release)

No schema changes except E0.5's query widening. Everything in `components/maps/choropleth-map.tsx`,
`components/explore/geo-comparison-figure.tsx`, `lib/charts/color-scale.ts`, `lib/db/indicators.ts`.

### E0.1 Legend + honest bins
- Replace `colorForValue`'s continuous min-max normalization with **quintile bins** computed from
  the current child values (fall back to fewer bins when <5 distinct values; single-value case
  keeps the mid-ramp behavior). Fix the existing max-value bucket overflow (`floor(t*7)` sends
  t=1 out of range, currently clamped — make binning explicit instead).
- New `MapLegend` component rendered inside `GeoComparisonFigure` under the map: one swatch per
  bin with its value range, plus the `NO_DATA_COLOR` swatch labeled "No boundary/data — see list".
  Legend is real DOM (not canvas), so it's accessible even though the map isn't.
- Figure caption gains the scale disclosure: "Color bins are quintiles across the N
  {provinces} shown."
- **Verify:** legend ranges match the ranked list's actual values at national, one region, one
  province; bins recompute on drill; axe clean.

### E0.2 Hover tooltips + select-then-drill
- Pointer: MapLibre `mousemove` on `geo-fill` shows a positioned tooltip (name · value with unit ·
  N profiled), "No data — see ranked list" for grey polygons. Tooltip is presentational
  (`aria-hidden` container) — the accessible path remains the list.
- **Click no longer navigates immediately.** First click/tap selects: polygon gets a selection
  outline, and a pinned mini-card (rendered in DOM below/over the map) shows name, value, N, and
  two actions: **"Open {name} →"** (performs today's `setFilters` drill) and dismiss. Second
  click on the same polygon also drills. This is one flow for mouse and touch.
- Keep `getCanvas().tabIndex = -1`; the mini-card's buttons are ordinary focusable DOM.
- **Verify (Playwright):** hover shows correct name/value against the list; click selects without
  navigation; "Open" navigates identically to the old click (URL `?geoLevel=…&geoCode=…`);
  Esc/outside-click dismisses; touch emulation: tap selects, tap "Open" drills.

### E0.3 Gesture fixes + controls
- `cooperativeGestures: true` in the Map constructor (Ctrl/Cmd+wheel to zoom, two-finger touch
  pan) — kills the page-scroll trap. Add `NavigationControl` (zoom ±) and a "reset view" control
  that re-runs the existing `fitBounds`. Keep `attributionControl: false` (no basemap tiles).
- **Verify:** wheel over map scrolls the page; Ctrl+wheel zooms; reset restores full extent;
  mobile viewport one-finger drag scrolls the page.

### E0.4 Map ↔ list linked highlighting
- Lift a `hoveredGeoCode` state into `GeoComparisonFigure`; map hover sets it, and the ranked
  list highlights the matching row; hovering a list row outlines the polygon (feature-state or a
  dedicated highlight line-layer). Requires the ranked list rows to know their `geoCode` — thread
  it through `FigureView`/`BarChartClient` props or wrap with a lightweight hover layer; prefer
  the smallest change that doesn't disturb `BarChartClient`'s export-shared chart spec.
- **Verify:** hover round-trips both directions; no interference with chart/table toggle.

### E0.5 Small-N signaling
- Widen `getChildIndicators` to also select `n_total` from `agg_geo_summary`. Polygons whose
  `n_total < MIN_LEADER_N` (import the constant from `lib/db/insights.ts`) render desaturated/
  hatched (MapLibre `fill-pattern` or reduced opacity + dashed outline), tooltip and mini-card
  say "Only {n} BHWs profiled — rate is unstable." Ranked list marks the same rows.
- **Verify:** pick a province view with a known small-N child; confirm hatching + note; confirm
  the threshold and wording match the insights convention.

### E0.6 Telemetry + pending feedback
- `logEvent` calls (pattern from `geo-cascade.tsx`): `map_select`, `map_drill`,
  `map_hover_tooltip` (sample: log first per pageview only), and later `map_indicator_change`
  (E1.1). Meta: geoCode, childLevel.
- Route-transition pending indicator for the whole Explore page: a thin top progress bar driven
  by `useLinkStatus`/transition state so cascade picks, chip clicks, and map drills all show
  activity during the ~1.8 s RSC re-render. Scope it to Explore's layout, not global, unless
  trivially global.
- **Verify:** events appear in `usage_events` with correct meta; pending bar shows during a
  throttled navigation and disappears on settle.

**Phase E0 release gate:** all six increments merged; Lighthouse a11y = 100 on `/explore` at
national/region/province; JS budget unchanged (maplibre stays lazy); `DECISIONS.md` updated.
Capture the **telemetry baseline** (XU3): two weeks of map/cascade events before E1 ships, so
E1's impact is measurable. Do not block E1 development on the two weeks — only its evaluation.

---

## Phase E1 — Explore identity (indicator-first workbench)

### E1.1 Indicator switcher (map + ranked list)
- New URL param `mapIndicator` (default `pct_accredited`) via `lib/filters/schema.ts` +
  `codec.ts` (+ codec tests). Values: `pct_accredited`, `any_honorarium_pct`,
  `households_per_bhw`, `avg_active_years`, `coverage_pct`, `training:<topic_slug>`.
- Data: extend `getChildIndicators` to return all base indicators per child in one query —
  `agg_geo_summary` (pct_accredited, any_honorarium_pct, n_total) joined/merged with
  `agg_bhw_counts` (avg_active_years) and `agg_bhw_stepzero_counts` (households, n_total_bhw →
  households_per_bhw; validated/n_total_bhw → coverage_pct). Per-topic training is a separate
  query on `agg_training` for the child codes + selected topic, fetched only when a `training:`
  indicator is active. Respect the 1,000-row cap (children per parent max ≈ 1,639 only for
  national→citymun, which this figure never renders — but paginate defensively in the shared
  helper anyway).
- UI in `GeoComparisonFigure`: a labeled `<select>` (or segmented control for the five base
  indicators + a topic `<select>` that appears when "Training coverage" is chosen). Map recolors,
  bins recompute (E0.1), ranked list re-sorts, headline sentence re-templates per indicator
  ("{Top child} has the highest {indicator label}, at {value}"). Captions carry the right
  denominator per indicator (validated profiles vs StepZero universe — reuse the wording
  conventions from Home/place pages; households-per-BHW and coverage % are StepZero-denominated).
- Direction handling: for `households_per_bhw`, higher = heavier load, not "better" — the
  headline template and legend order must not imply ranking valence; state "highest/lowest",
  never "best/worst".
- Log `map_indicator_change`.
- **Verify:** each indicator round-trips through the URL (permalink restores indicator + topic);
  values spot-checked against place-page figures for 2 geos per indicator; suppressed/absent data
  renders grey + "no data" rows, never 0.

### E1.2 Page restructure
- New order in `app/explore/page.tsx`: breadcrumb chips → labeled summary strip → **map figure**
  → distribution (E1.3) → relationships (E1.4) → figure groups → insights. Delete the two
  big-number cards (Accreditation, Avg years) — their numbers live in the strip and the switcher.
- Summary strip: add labels/heading, `GlossaryTerm` on "validated profiles", "households per
  BHW"; add a compact link to the denominator explainer content (reuse `DenominatorExplainer`
  collapsed or link to `/methodology` — do not re-render Home's full explainer card).
- **Verify:** visual pass at 360px and 1280px; axe; no orphaned imports; screenshot in PR.

### E1.3 Distribution view ("spread among {children}")
- New `components/explore/distribution-figure.tsx`: histogram or dot-strip of child values for
  the current `mapIndicator` (same data as E1.1 — no new queries), parent's own value marked
  ("{Parent} overall: 62%"). `FigureCard` contract; chart/table toggle via `FigureView` if the
  bar-shape fits, else a small bespoke SVG consistent with `lib/charts` idioms.
- Headline template: "Most {provinces} fall between {p25}% and {p75}%; {outlier} stands out."
- **Verify:** parent marker matches the strip; small-N children visually flagged consistently
  with E0.5.

### E1.4 Relationships view (scatter) + correlation-in-words (S7)
- New `components/explore/relationship-figure.tsx`: scatter of children — X and Y each pick from
  the E1.1 indicator set (two new URL params `relX`, `relY` with sensible defaults, e.g.
  households_per_bhw × pct_accredited). Dot size ∝ n_total, hover label (name + both values),
  click → that child's place page. SVG in the existing chart idiom (Observable Plot is already
  in the bundle, lazy-loaded).
- Statistic: Spearman rank correlation computed client-side from the plotted points (n ≤ ~120 at
  worst — trivial), rendered *in words* with the review's framing: "Places with higher X tend to
  have lower Y — a {weak|moderate|strong} link. This compares places, not individual BHWs."
  Thresholds documented in `/methodology`; small sample (<10 children) → "too few places to
  assess a pattern" instead of a coefficient.
- Exclude small-N children from the correlation (same MIN_LEADER_N rule), show them as hollow
  dots.
- **Verify:** correlation sign/strength sanity-checked against two hand-computed cases; URL
  round-trip; place-page links correct.

### E1.5 Figure parity + exports
- Add to Explore (all responding to the geo filter, which Home cannot do): `CertificationFigure`;
  honorarium as one tabbed card (`FigureTabs`: Who receives · How much · Distribution — the same
  composition as Home, different geo scope); `BenchmarkBars` vs region/national on accreditation,
  avg-years, training, honorarium (pattern + ancestor queries from the place page — ancestors are
  already fetched); `CompletenessFigure` at the current geo; `ExportMenu` on every figure that
  has a route (avg-years export exists on place — mirror it; map/distribution/relationship
  figures get exports later, E5).
- **Verify:** benchmark values match place page for the same geo; export links resolve for 2
  sample geos; barangay-level fallbacks (training, completeness) still render their citymun
  pointers.

### E1.6 Sidebar + edge states
- Add compact `GeoSearch` (existing variant) above the cascade; retitle breakdown picker to
  "Add demographic figures" with a one-line hint; at citymun/barangay render the map-absence stub
  card ("Maps below city/municipality level are on the roadmap — the ranked list below covers
  every barangay") linking `/roadmap`.
- **Verify:** search navigates within Explore (stays on `/explore` with new geo params, not to
  place pages — this is the explore-context behavior; if the variant only links to place pages,
  add a `mode` prop); stub shows only at the right levels.

**Phase E1 release gate:** full-cascade Playwright pass (national→barangay) exercising switcher,
distribution, relationships, parity figures at each level; Lighthouse budgets re-checked
(charts/map still lazy); telemetry comparison against the E0 baseline written into
`DECISIONS.md`.

---

## Phase E2 — Cheap derived statistics + dormant fields (no new ingestion)

Order within E2 is free; all are small.

### E2.1 Surface computed-but-unread fields
- `agg_training.median_training_year` → training figure gains "median last-trained year" column/
  tooltip + a staleness flag (topic trained ≥5 yrs ago median → "may be due for refresher");
  wording plain, threshold in methodology.
- `agg_bhw_stepzero_counts.pct_registered_accredited` → new small figure or strip stat:
  "LGU-reported accreditation vs verified profiles" (triangulation framing from the review;
  technical details explain the two sources; do NOT average them).
- `population` → "BHWs per 1,000 residents" strip stat + E1.1 indicator (`bhw_per_1000`),
  captioned "population as self-reported in StepZero barangay sheets" until E4 replaces the
  denominator with census data.

### E2.2 Wilson intervals (S1)
- `build_aggregates.sql`: add `ci_low`/`ci_high` (Wilson, 95%) to `agg_bhw_counts`
  (pct_accredited), `agg_training` (coverage_pct), `agg_honorarium` (pct_receiving). Closed-form
  SQL; migration + aggregate rebuild.
- UI: enlarged figure views show interval whiskers; technical details state the interval; the
  map's small-N rule (E0.5) may additionally use CI width ≥ a threshold — keep the N rule as the
  primary, CI as refinement.
- Glossary: "confidence interval" in plain terms ("the range the true rate is very likely in,
  given how few people were counted").

### E2.3 Peer percentile ranks (S3)
- `build_aggregates.sql`: `percent_rank()` over same-level siblings (within parent, and within
  nation for region level) for the E1.1 indicator set → new columns on `agg_geo_summary` (or a
  thin `agg_peer_ranks` table if column sprawl threatens).
- UI: chip on relevant figures + map mini-card: "Ranks {k} of {n} {provinces} in {region}".
- Suppression: no rank chip when `n_total < MIN_LEADER_N`.

### E2.4 Outlier flags (S4)
- Build-time MAD-based flag among siblings (|value − median| > 3×MAD, min 8 siblings) → boolean
  per geo/indicator alongside E2.3's ranks. Surfaces: ranked-list badge, map outline, and a new
  insight generator ("{Name} stands out from other {provinces} on {indicator}") wired into
  `lib/db/insights.ts` with the existing score/curation conventions.

### E2.5 Data-quality grade (S10)
- Collapse `agg_data_completeness` per geo into a weighted grade (A ≥95% avg completeness on key
  fields, B ≥85%, C below; weights + field list in methodology). Show beside Explore figures
  ("Data completeness here: B — blood type is often missing") linking `/data-quality`. Barangay
  falls back to citymun with the label, mirroring `CompletenessFigure`.

**Verify (phase):** aggregate rebuild runs clean on the live data; spot-check 3 geos' CI/rank/
flag values by hand; suppression audit repeated (the DoD-style spot check from 1.10) since new
columns ship at barangay grain.

---

## Phase E3 — New internal aggregates (ingestion changes)

Each increment = migration + `ingest.py`/`build_aggregates.sql` change + rebuild + UI.

### E3.1 `ROLE` dimension — audit gate first
- **Audit before building:** distinct values, counts, free-text-ness of parquet `ROLE`. Gate: if
  ≤ ~30 clean categorical values → ingest as demographics dimension `role` (7th checkbox, same
  suppression); if messy free text → write findings to `DECISIONS.md` and downgrade to a
  normalization proposal for the owner instead of shipping garbage categories. PII check: role
  strings must not contain names/contact info.

### E3.2 Year cohorts (approved framing Q5)
- New `agg_cohorts`: geo × cohort_year × kind (`registered`, `accredited`, `first_active`) × n.
  National→citymun grain (skip barangay — size + suppression). UI: "waves" bar figure on Explore
  ("When did today's BHWs join/get accredited?") with the locked caption "years as recorded in
  the 2025 snapshot"; technical details carry the survivorship caveat verbatim from the review
  (§9 S6 note).

### E3.3 Retention/attrition curves (S6)
- From `active_years` arrays: per starting-cohort share still active after k years →
  `agg_retention` (national + region grain only, to bound size). Figure: "Of BHWs who started in
  {year}, {x}% were still serving in 2025." Same survivorship caveat.

### E3.4 Workload distribution (S5b)
- Per-BHW `household` field → `agg_workload`: p10/p25/median/p75/p90 + share-covered-by-busiest-
  decile per geo (suppress <5). Figure mirrors the honorarium distribution presentation.
  Headline: "The busiest 10% of BHWs here cover {x}% of assigned households."

### E3.5 Honorarium inequality (S5a)
- Extend `agg_honorarium` (or sibling table) with Gini + p90:p10 of monthly amounts among
  receiving BHWs per geo (suppress <5 receiving). Surface inside the honorarium tabbed card as a
  fourth tab or within Distribution. Headline: "The best-paid tenth of BHWs receive at least
  {r}× what the least-paid tenth receive."

### E3.6 Adjusted small-area rates (S2 — approved Q7)
- Empirical-Bayes shrinkage toward the parent (method-of-moments beta-binomial; implement in
  `build_aggregates.sql` or a small Python step in the aggregate build) → `adjusted_pct` columns
  beside raw for accreditation (and honorarium % if clean). UI: **raw by default**, an "adjusted
  for small numbers" toggle on the map + ranked list; label on every adjusted rendering;
  methodology section with the formula and a worked example; glossary entry. Never adjust
  national/region (large-N) — only levels where small N occurs (citymun/barangay grain).

### E3.7 Income-class equity view
- Requires no external data (uses `dim_geo.income_class`, refreshed later by E4.3): indicator
  medians by LGU income class (1st–6th) at national scope → small figure "Do lower-income
  municipalities support their BHWs less?" (median honorarium amount, any-honorarium %,
  pct_accredited by class). Precompute into `agg_by_income_class`.

**Verify (phase):** every new table has RLS matching existing `agg_*` (public read, service
write); rebuild timings acceptable; suppression audit extended to the new tables; UI figures
match hand-computed values for 2 geos each.

---

## Phase E4 — External datasets (Tier 1 + cited-public DOH)

Per owner Q3. Each source = `dim_dataset` row (slug, source, license, retrieved_at) + ingestion
script + `agg_*` table + methodology/attribution updates. All are one-time static loads.
Re-verify each download URL in a browser first (research pass hit bot-blocks; sources are public).

### E4.1 PSGC crosswalk table (do first — infrastructure)
- Quarterly PSA PSGC datafile → `dim_psgc_crosswalk` (old_code, new_code, vintage, change_kind).
  Used by every subsequent load to map source vintages onto `dim_geo`'s codes; unmatched codes
  logged both ways (the 1.6 reconciliation discipline).

### E4.2 Population: PSA 2024 POPCEN + 2020 CPH
- `agg_population` (geo_code × {pop_2024, pop_2020, households_2020}) at barangay grain rolled
  up. Slugs `psa-popcen-2024`, `psa-cph-2020`. License: PSA open terms, attribution.
- UI: E2.1's per-capita indicator switches denominator to census population (caption updated);
  StepZero-vs-census population becomes a data-quality triangulation note on `/data-quality`.

### E4.3 DOF/BLGF 2024 LGU income reclassification
- Name-match join (~1,650 rows, via E4.1 crosswalk + manual fixups file). Refresh
  `dim_geo.income_class` (keep the old value as `income_class_2019` for provenance) — E3.7's
  figure re-runs on the new classes. Cite DOF DO 074-2024.

### E4.4 PSA SAE 2021 poverty (flagship)
- `agg_poverty` (citymun × poverty_incidence + CI columns as published). Joins the Relationships
  view (E1.4) as X/Y options at province/citymun grain, each with source-stamped caption
  ("Poverty incidence: PSA Small Area Estimates 2021 · city/municipality") and the
  ecological-comparison sentence. Also a map indicator? **No** — the map stays BHW-workforce
  indicators; external variables appear only in Relationships (identity rule Q1). Exception:
  per-capita BHW density uses census population as *denominator*, which is fine.
- New insight generator: "BHW density vs poverty" only if the correlation is |ρ|≥ the moderate
  threshold — never fabricate a story from noise.

### E4.5 DOH NHFR facilities (public export, cited)
- Snapshot the public facility list export; geocode via its region/province/citymun/barangay
  fields → `agg_facilities` (geo × counts by facility type). Cite NHFR + retrieval date
  (owner Q3: public-with-citation is sufficient). Enables: facilities-per-geo in Relationships,
  and a place-page context chip later ("3 barangay health stations here") — the chip is Place
  work, log it as a follow-up, don't build it in this plan.
- If the export turns out not to carry clean geo codes, stop at province-level name matching and
  record the limitation; do not geocode addresses.

### E4.6 FHSIS extracts (cited)
- Lowest priority. Extract the BHW headcount + selected service-delivery tables from the public
  annual-report PDFs at province grain → `agg_fhsis` + a methodology reconciliation note
  extending the existing 277,767-vs-278,240 story. Skip if PDF extraction proves unreliable —
  document instead.

**Verify (phase):** every join reports unmatched-code counts committed to `docs/` (1.6 style);
`/methodology` lists every source with license + retrieval date; footer/dataset attribution
pulls from `dim_dataset`, not hardcoded; Relationships external variables show source captions.

---

## Phase E5 — Deferred tail (build only when E0–E4 are digested)

- **S8 spatial clustering** (adjacency from GeoJSON at build time → LISA/Getis-Ord hot/cold
  spots; map cluster outlines + insight generator).
- **S9 scorecard** (component chip-row per geo using E2.3 percentiles — scorecard only, per Q8).
- **Map PNG export** through the export pipeline; **PMTiles barangay maps** (use HDX COD-AB as
  the boundary source candidate; needs its own vintage reconciliation pass).
- **UX research loop** (runs alongside, not after): E0's baseline capture; post-E1 funnel
  comparison; one-question intercept on Explore; 3-task moderated tests (find your barangay's
  figures · find which province in your region pays honoraria least · judge whether training
  coverage here is good) — write findings into `DECISIONS.md` and let them reorder E2–E4
  priorities.

## Handoff notes for the implementing agent

1. Work on a feature branch per increment (or per phase for E0), PR against `main`; follow the
   repo's verify-and-log discipline (`DECISIONS.md` entry per increment with evidence).
2. Read before coding: `BUILD_PLAN.md` §4–§5 (architecture, standards, pitfall register),
   `DECISIONS.md` 1.4/1.6/1.10 (explore, maps, perf/caps history), `EXPLORE_PAGE_REVIEW.md`
   (rationale — especially §7–§9 framings, which are the spec for wording).
3. Database changes go through `supabase/migrations/` + `ingestion/build_aggregates.sql` and are
   applied with the existing tooling; never widen RLS beyond the established public-read-on-
   aggregates pattern. Rebuilds run against the live free-tier project — check table sizes
   before adding barangay-grain tables (the 500 MB budget is why training/completeness skip
   barangay).
4. Chart work reuses `lib/charts` specs so exports keep working; anything rendered client-side
   heavy (map, Plot) stays behind `next/dynamic`.
5. When a decision point arises that this plan doesn't cover, prefer: (a) the identity rule
   (§0 Q1), (b) the figure contract, (c) ask the owner — in that order.
