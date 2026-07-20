# Explore Page Review — Four-Lens Assessment & Enhancement Recommendations

A four-lens review (designer · lay person · epidemiologist · **UX researcher**) of the `/explore`
dashboard, following the method established by `HOME_SEARCH_REVIEW.md` — concluding in prioritized
recommendations covering (a) the whole page, (b) deeper map interaction specifically, (c) dataset
variables ingested but never surfaced, and (d) whether Explore is the right home for cross-analysis
against external data sources.

**Status:** recommendations only — reviewed 2026-07-20 against `main` (`ee1b383`). No implementation
plan is committed yet; the plan is agreed with the owner after this review is discussed (see §11
open questions).

**Hard constraint honored throughout:** nothing below duplicates what the Home page already does
(national KPI tiles, certification/honorarium national storytelling, the hero geo search) — the
recommendations deliberately push Explore toward what no other page does. Where a component is
*reused* (e.g. `FigureTabs`, the compact `GeoSearch` variant already reused on place pages), that is
reuse of shared infrastructure, not duplication of the Home experience.

## 1. Scope & method

Surfaces reviewed:

| Surface              | Files                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explore page         | `app/explore/page.tsx`                                                                                                                           |
| Filter sidebar       | `components/filters/geo-cascade.tsx`, `components/filters/breakdown-picker.tsx`, `components/filters/active-filter-chips.tsx`                    |
| Map figure           | `components/explore/geo-comparison-figure.tsx`, `components/maps/choropleth-map.tsx`, `lib/charts/color-scale.ts`                                |
| Explore figures      | `components/explore/*-figure.tsx`, `components/narrative/figure-card.tsx`, `components/charts/figure-view.tsx`                                   |
| Adjacent pages       | `app/page.tsx` (Home), `app/place/[geoLevel]/[geoCode]/page.tsx`, `app/compare/page.tsx` — read to establish the no-duplication boundary          |
| Data layer           | `lib/db/indicators.ts`, `lib/db/stepzero.ts`, `lib/db/insights.ts`, `ingestion/build_aggregates.sql`, `ingestion/ingest.py`, raw source files    |

The four lenses:

- **Designer** — is the interface legible, honest about state, and free of friction?
- **Lay person** (a BHW, their family, an LGU staffer) — can I find my place and understand what I
  see without training?
- **Epidemiologist** — are denominators, comparators, scales, and completeness handled the way a
  technical reader needs?
- **UX researcher** *(new for this review)* — do the page's task flows match real user goals, is the
  information architecture coherent across pages, and is the product instrumented to learn from
  actual behavior?

### What already works well (keep these)

- **URL-as-state discipline.** Every filter (geo, breakdowns) round-trips through the URL via nuqs
  with `history: "push"` — permalinks, Back/Forward, and shareability all work. This is the
  foundation the recommendations below build on (an indicator switcher is just one more URL param).
- **The `FigureCard` contract** (Person/Place/Time caption, layman headline, collapsed technical
  details) is applied consistently, and suppression rendering (n<5 + roll-up link) is exemplary.
- **The map's accessible-by-construction design** — the ranked list below the map always renders the
  same data, so the choropleth can stay `aria-hidden` without excluding anyone. Any map enhancement
  must preserve this pairing.
- **Server-rendered option lists for the cascade** — no client geo-fetch layer, no loading-state
  complexity in the sidebar itself.
- **Bad-permalink resilience** — garbage URLs fall back to the national view rather than erroring
  (the right failure mode for a browsing tool, per `DECISIONS.md` 1.5).

## 2. The core structural finding: Explore has lost its identity

This is the frame for everything below, visible from a straight feature matrix:

| Capability                                   | Home | Place | Compare | **Explore** |
| -------------------------------------------- | :--: | :---: | :-----: | :---------: |
| Accreditation / avg-years / demographics / training / honorarium figures | ● (national) | ● | ● | ● |
| Benchmarks ("vs. region / Philippines")      |  —   |   ●   |    —    |    **—**    |
| Children drill-down table                    |  —   |   ●   |    —    |    **—**    |
| Per-geo data completeness figure             |  —   |   ●   |    —    |    **—**    |
| AI insight narrative                         |  ●   |   ●   |    —    |    **—**    |
| Honorarium amount + distribution figures     |  ●   |   —   |    —    |    **—**    |
| Certification figure                         |  ●   |   —   |    —    |    **—**    |
| Free-text place search                       |  ●   |   ●   |    ●    |    **—**    |
| Choropleth map                               |  —   | thumbnail | —  |    ● (1 indicator) |
| All six demographic breakdowns               |  —   |   —   |    —    |     ●       |

Since the Home/Search enhancement work (PRs #30–#35), the **place page has leapfrogged the page
that is supposed to be the "full breakdowns" destination**. The place page's "Explore full
breakdowns" button now leads to a page with *fewer* analytical affordances than the page the user
just left (no benchmarks, no drill-down table, no completeness, no AI narrative) — the only things
gained are the breakdown checkboxes and a single-indicator map. Meanwhile Home shows honorarium
depth (amount, distribution) that Explore, the supposed deep-dive page, does not.

**The recommendation that follows from this is not "copy the place page's features onto Explore."**
It is to give Explore the one identity no other page has — the **analyst's workbench**: the place
where you pick an *indicator* (not just a place) and see it across geography — on a map, as a
ranked list, as a distribution, and against other indicators. Place pages stay place-first
narrative; Home stays national narrative; Compare stays N-way side-by-side; Explore becomes
indicator-first analysis. That framing drives §7–§9.

## 3. Designer review

### The map

- **XD1 — No legend.** The choropleth paints seven sequential-ramp buckets
  (`lib/charts/color-scale.ts`) plus a grey no-data fill, and *none of it is explained on screen*.
  A reader cannot tell whether dark teal means high or low, what the range is, or that grey means
  "no boundary/data" (the explanation is buried in collapsed technical details).
- **XD2 — Relative color scale per view.** `colorForValue(value, min, max)` normalizes to the
  *current children's* min/max, so the same color means a different value on every view — Region VI
  at 83% and a province view where the darkest polygon is 45% look identical. Nothing on screen
  discloses this.
- **XD3 — No hover feedback beyond a cursor change.** Hovering a polygon shows `pointer` but no
  name, no value, no N. On a shape-only map with no labels, the user must already recognize every
  region/province silhouette — or click blind.
- **XD4 — Click = instant full-page navigation.** The only interaction is a click that immediately
  rewrites the URL and re-renders the whole server page (~1.8 s TTFB measured in 1.10). There's no
  preview, no confirmation of *what* you're about to drill into, and an accidental click costs two
  slow navigations (in + Back).
- **XD5 — Scroll/gesture trap.** MapLibre is instantiated with default handlers: wheel over the map
  zooms the map instead of scrolling the page, and on touch devices a one-finger drag pans the map
  instead of scrolling — a mid-page 320 px-tall scroll trap on a long page. No zoom controls, no
  reset-view button either, so a mis-zoomed map has no recovery affordance.
- **XD6 — No map ↔ list linkage.** The ranked list below the map shows the same data, but hovering
  a bar doesn't highlight the polygon and vice versa; the two visuals read as unrelated figures.

### The rest of the page

- **XD7 — No pending state on filter change.** Picking a cascade option or clicking the map
  triggers a full RSC re-render with zero visual feedback until the new page arrives — on the
  page's own measured ~1.8 s TTFB, that's nearly two seconds where the UI looks frozen/ignored.
- **XD8 — Fixed, arbitrary figure order with the map buried.** The grid always renders: two
  big-number cards → map → demographics → training → honorarium. The page's centerpiece (the map)
  sits below two cards whose numbers already appear in the summary strip directly above them —
  Accreditation appears **three times** in the first screenful (strip → card → map figure).
- **XD9 — Inconsistent export coverage.** Explore's Avg-years card has no `ExportMenu` while the
  same card on place pages does; the map figure has no export at all.
- **XD10 — Summary strip is unlabeled.** The three numbers (total / validated / households-per-BHW)
  render as an inline run of text with no heading, no glossary tooltips, and no link to the
  denominator explainer that Home ships for exactly these terms.

## 4. Lay person review

- **XL1 — The cascade assumes you know the administrative hierarchy.** To reach a barangay you must
  correctly pick region → province → city/mun → barangay in order. A resident who knows only their
  town's name has no free-text path on this page (search exists on Home, place pages, and Compare —
  Explore is the only primary page without it). The fix is *reusing* the existing compact
  `GeoSearch` variant in the sidebar, not building anything new.
- **XL2 — Anonymous shapes.** No polygon labels and no hover names (XD3) make the map unreadable
  for the very audience maps most help — people who recognize *where they live*, not statistics.
  "Click a shaded area" (the technical-details instruction) requires already knowing which shape is
  yours.
- **XL3 — The map silently vanishes at city/municipality level and below.** Drilling past province
  removes the figure entirely with no explanation (the reason — barangay polygons deferred — lives
  in the codebase, not the UI). To a user it reads as a bug or missing data.
- **XL4 — "Demographic breakdowns" is analyst vocabulary** controlling only part of the page. The
  checkboxes add/remove demographics figures only, but sit in the sidebar styled like global
  filters — with nothing explaining what will change. Meanwhile jargon on the strip ("validated
  profiles", "N =") gets no `GlossaryTerm` treatment here, unlike Home post-#30.
- **XL5 — No narrative on the page.** Home and place pages open with an AI insight / layman story;
  Explore opens with a wall of numbers. The insights grid exists but is the last element on a very
  long page.

## 5. Epidemiologist review

- **XE1 — One indicator, and it's the least discriminating one.** The map can only show
  % accredited. The dataset's most decision-relevant spatial questions — where is workforce load
  heaviest (households/BHW)? where are honoraria not paid? where are training gaps? — are
  unmappable. Worse, `agg_geo_summary` already carries `any_honorarium_pct` and `top_training_gap`
  per geo, so the ceiling is the query/props shape (`getChildIndicators` selects only
  `pct_accredited`), not the data.
- **XE2 — Unbinned relative scale with no disclosure** (see XD2). For an epidemiologist this is a
  correctness issue, not polish: choropleth comparability depends on a stated classification
  (fixed breaks or quantiles, disclosed in a legend). Today's map cannot be read quantitatively at
  all — and the bucketing (`floor(t*7)`) even assigns the max value its own overflow bucket.
- **XE3 — No small-N signaling on the map.** A province colored by an accreditation % computed on
  12 profiled BHWs renders identically to one computed on 12,000. The suppression discipline
  applied so carefully to tables has no analogue on the map (no hatching, no minimum-N greying, no
  N in any tooltip — there are no tooltips).
- **XE4 — No denominator choice.** Rates only; no way to see counts, and no per-capita option even
  though StepZero `population` is already loaded per geo (`BhwOverview.population` is fetched and
  dropped). "% accredited" over a tiny profiled base can invert the real picture that a count or
  per-1,000 view would show.
- **XE5 — No benchmarks on Explore figures.** The "versus what?" fix shipped to place pages
  (`BenchmarkBars`) never reached Explore — the page for analysis is the one without comparators.
- **XE6 — Univariate everything; no relationships.** Every figure is one variable at a time. The
  obvious analyst questions — does honorarium receipt track accreditation? does LGU income class
  predict either? does workforce load correlate with training gaps? — require a scatter/ranked
  cross-view across child geos that doesn't exist anywhere in the app. (Within-person cross-tabs,
  e.g. accreditation × sex, need new aggregate tables with suppression; *across-geo* relationships
  need only data already in `agg_geo_summary`/`agg_bhw_counts` + stepzero.)
- **XE7 — The time dimension is ingested and thrown away.** `registered_year`,
  `accreditation_year`, TESDA/reference-manual years, `first/last_active_year`, `inactive_years`
  all sit in `fact_bhw_raw` unaggregated — and `agg_training.median_training_year` is *already
  computed* per topic per geo but never selected by any query. A 2025 snapshot does not preclude
  cohort/recency analysis ("half of X's BHWs last trained on immunization before 2018"); the
  captions would just need honest framing.
- **XE8 — Data-quality context is one click too far.** Explore surfaces no per-geo completeness
  (place pages do, post-#32), so a reader assessing, say, an education breakdown on Explore has no
  missingness context on the page where they're analyzing it.

## 6. UX researcher review

- **XU1 — No defined task model separates the pages.** Explore/Place/Compare answer overlapping
  questions with overlapping figures; nav labels ("Explore") don't communicate what's different.
  Recommend an explicit task model — Home: *orient*; Place: *look up my place*; Compare: *pit
  places against each other*; Explore: *analyze an indicator across places* — and let it decide
  every "where does this feature go?" question (including §9's external-data cross-analysis).
- **XU2 — Map interactions are invisible to telemetry.** `geo-cascade.tsx` logs `filter_change`,
  but `choropleth-map.tsx`'s click handler calls `setFilters` without `logEvent` — the team cannot
  currently answer "does anyone use the map?", the exact question this review begs. Instrument
  before/alongside investing in map depth: map clicks, hovers-with-tooltip (sampled), breakdown
  toggles, indicator switches.
- **XU3 — No behavioral baseline for the redesign.** `usage_events` + the admin usage dashboard
  already exist; before the enhancement plan lands, capture two weeks of: explore entry paths
  (home-hero vs place-page button vs direct), drop-off after first filter change (the XD7 latency
  will show up here), breakdown-picker usage, export clicks per figure. These become the success
  metrics for the plan itself.
- **XU4 — Progressive disclosure is inverted.** The most novice-hostile control cluster (a
  four-level cascade + six checkboxes) is the first thing on the page (and on mobile it pushes all
  content down), while the most broadly appealing artifact (the map) is below two number cards.
  Novices should meet the map first; the cascade is an expert shortcut.
- **XU5 — Mobile experience is a long undifferentiated scroll** — sidebar stack, then strip, then
  2-col grid collapsing to 1-col: 8+ cards deep with the gesture trap (XD5) mid-stream. No
  section anchors/jump nav, no sticky context of the current geo.
- **XU6 — No qualitative validation loop exists for this page.** `SpotFeedback` is wired on some
  surfaces but nothing asks Explore users task-level questions. Cheap instruments fit the free
  tier: a one-question intercept ("did you find what you came for?"), and 5-user moderated tests
  with a BHW, an LGU staffer, and a DOH analyst on three scripted tasks (find your barangay's
  figures; find which province in your region pays honoraria least; say whether training coverage
  here is good or bad). The scripts and success criteria should be part of the enhancement plan.

## 7. Recommendations — the map (deeper interaction)

Ordered so each builds on the previous; all preserve the always-rendered ranked-list pairing
(BUILD_PLAN §4.3) and the free-tier budget (no tile servers, static GeoJSON stays).

- **M1 — Indicator switcher (the single highest-value change).** A segmented control / select on
  the map figure: **% accredited · any-honorarium % · households per BHW · avg years of service ·
  profile coverage % · (per-topic training coverage as a stretch)**. State lives in a new URL param
  (`mapIndicator`), the map recolors and the ranked list re-sorts together. Data: extend
  `getChildIndicators` to select the extra columns (`agg_geo_summary` + a stepzero join); no new
  aggregates needed for the first four. This turns "a map of accreditation" into "the map of the
  dataset," and is what makes Explore non-duplicative: no other page can map any indicator.
- **M2 — Hover tooltips + touch equivalent.** Pointer: name, indicator value, N (and "no data ·
  see ranked list" for grey). Touch: first tap selects + shows the same info in a pinned mini-card
  with an explicit **"Open [place] →"** action; second interaction drills. This also fixes XD4's
  accidental-navigation cost on touch.
- **M3 — Legend + honest scale.** Quantile or fixed-break bins (disclosed), rendered as a compact
  swatch legend with the no-data swatch; scale annotation in the figure caption ("bins are
  quintiles across the N provinces shown"). Fix the max-value bucket overflow while in there.
- **M4 — Small-N signaling.** Below a minimum profiled-N (reuse `MIN_LEADER_N = 30` from
  `lib/db/insights.ts`), render the polygon hatched/desaturated and say why in the tooltip —
  the map equivalent of the suppression discipline the tables already have.
- **M5 — Map ↔ list linked highlighting.** Hover a bar → outline the polygon; hover a polygon →
  highlight the bar. One shared `hoveredGeoCode` state in `GeoComparisonFigure`; makes the pairing
  legible as one figure and doubles as the lay-person path to naming shapes (XL2).
- **M6 — Cooperative gestures + controls.** `NavigationControl` (zoom/reset), `cooperativeGestures:
  true` (Ctrl+wheel to zoom, two-finger pan on touch) — kills the scroll trap outright.
- **M7 — Preview-then-drill click.** Desktop click behaves like M2's touch flow (select + pinned
  card with "Open →"), so drilling is always intentional; pair with a route-transition pending
  indicator (XD7) for when navigation does happen.
- **M8 — Instrument everything above** (XU2): `map_click`, `map_drill`, `map_indicator_change`.
- **M9 — (Later) citymun→barangay maps via PMTiles** — already on the roadmap as Phase 2+; M1–M8
  don't depend on it, but the indicator-switcher architecture should keep the data-join shape
  tile-friendly (values looked up by geo_code at render, exactly as today).
- **M10 — (Later) map PNG export** through the existing export pipeline, once M1/M3 stabilize what
  a map figure *is*.

## 8. Recommendations — the rest of the page

- **R1 — Reframe the page around the map + indicator.** Order: geo context header → **map figure
  (with M1 switcher) + ranked list** → distribution/relationship views (R3/R4) → per-theme figure
  groups → insights. The two big-number cards dissolve into the summary strip (XD8); the strip gains
  labels + glossary terms (XD10/XL4).
- **R2 — Reach parity where Explore is inexplicably shallower.** Add the certification figure and
  the honorarium amount/distribution views (as one tabbed card, reusing `FigureTabs` exactly as
  Home does — reuse, not duplication: here they respond to the geo filter, which Home can't do);
  add `BenchmarkBars` against parent/national on Explore figures (XE5); complete `ExportMenu`
  coverage (XD9); surface the place-page completeness figure at the current geo (XE8).
- **R3 — Distribution view ("spread among children").** For the selected indicator, a
  histogram/strip of child-geo values with the parent's value marked — answers "is my province's
  62% typical or an outlier?" with data already fetched for the map.
- **R4 — Relationships view (in-dataset cross-analysis).** A scatter of child geos: X = one
  indicator, Y = another (dot size = N, dot label on hover, click → place page). Powered entirely
  by existing per-geo aggregates at region/province/citymun grain — no new tables, no suppression
  exposure (geo-level rates only). This is the natural seat for §9's external variables later:
  the X-axis source just gains non-BHW options. Watch the PostgREST 1,000-row cap if ever run at
  national→citymun grain (1,639 rows — paginate or pre-join server-side).
- **R5 — Sidebar: add the compact `GeoSearch` variant above the cascade** (XL1 — the identical
  reuse place pages already made), keep cascade as the expert path, and retitle/annotate the
  breakdown picker ("Add demographic figures").
- **R6 — Explain map absence at deep levels** (XL3): at citymun/barangay, render a stub card —
  "Maps below city/municipality level are coming (see roadmap); here's the ranked list" — rather
  than omitting the figure silently.
- **R7 — Pending feedback on every filter/map navigation** (XD7): a top progress bar or
  `useLinkStatus`-style indicator during RSC re-render.
- **R8 — Surface the dormant variables** (from the dataset inventory, cheapest first):
  1. **Training recency** — `agg_training.median_training_year` is already computed; add it to the
     training figure ("median last-trained year") and flag stale topics. Zero ingestion work.
  2. **Self-reported vs verified accreditation** — `agg_bhw_stepzero_counts.pct_registered_accredited`
     (computed, never read) vs `pct_accredited`: a built-in triangulation figure and honest
     data-quality story.
  3. **Per-capita rate** — `population` is already fetched per geo; add BHWs-per-1,000-residents as
     an M1 map indicator + strip stat (labeled as StepZero self-reported population).
  4. **New aggregates (one migration + rebuild each):** accreditation/registration **year cohorts**
     ("waves"), **workload distribution** from per-BHW `household` (not just the mean), **attrition
     signal** from `inactive_years`, **income-class equity view** (indicator medians by LGU income
     class — `dim_geo.income_class` is currently decoration).
  5. **`ROLE` column** — exists in the parquet, never ingested; would need an ingestion change +
     new dimension. Flagged for the owner: is role/designation analytically interesting and clean
     enough to publish?

## 9. Cross-analysis with external data sources

### 9.1 Is Explore the right page for it? Yes — with a specific shape

Under §6 XU1's task model, cross-dataset analysis is indicator-first work ("does BHW density track
poverty?"), which makes **Explore's Relationships view (R4) its natural seat**: external variables
become additional axis/map-indicator options at the geo levels where the external source is
published. What external data should *not* become: a new top-level page (nothing to hang it on
yet), a Home feature (Home is national narrative), or a place-page figure beyond, at most, one
context chip (e.g. poverty incidence next to income class). Two design rules keep it honest:

1. **Never mix denominators silently.** External variables joined at province/citymun grain must
   carry their own Person/Place/Time caption (source, year, grain) — e.g. "Poverty incidence: PSA
   SAE 2021 · city/municipality". The `FigureCard` contract already supports this.
2. **Correlation ≠ causation framing.** Relationship views across LGUs are ecological
   comparisons; captions and the methodology page should say so explicitly.

The existing `dim_dataset` registry (BUILD_PLAN §1: "this dataset is #1 of many") was designed for
exactly this — each source below is a candidate `dim_dataset` row + one `agg_*` table.

### 9.2 Ranked candidate sources (feasibility × value)

Deep-dive research (2026-07-20) updating `DATASET_SCOPING.md`; PSA/DOH/HDX sites partially block
automated fetchers, so download URLs should be re-verified in a browser before ingestion work.

**Tier 1 — ingest-ready (open/clear license, PSGC-keyed or trivially joinable, one-time static
loads of a few MB each):**

| Source | Grain | What it enables | Notes |
| --- | --- | --- | --- |
| **PSA 2024 POPCEN population** (declared official Jul 2025, 10-digit PSGC) | barangay↑ | BHWs per 1,000 residents everywhere; validates StepZero's self-reported population | Supersedes the scoping doc's 2020-CPH-first recommendation; OpenSTAT terms are attribution-only (CC BY-equivalent) |
| **PSA 2020 CPH** | barangay↑ | Households variable + the vintage matching SAE poverty; 2020→2024 growth context | Same license/access |
| **PSA Small Area Estimates of poverty 2021** | citymun | **The flagship cross-analysis:** BHW density / honorarium / accreditation vs. poverty incidence | One Excel; verify PSGC codes in-sheet vs. name-join |
| **DOF/BLGF LGU income classification 2024** (RA 11964 reclassification, effective Jan 2025) | province + citymun | Honorarium-vs-LGU-fiscal-capacity equity story; also refreshes `dim_geo.income_class` (dataset carries the pre-2024 classes) | ~1,650 rows, name-match join; gov't work (RA 8293 §176), low republication risk |
| **PSGC quarterly datafile** | all | Vintage crosswalk infrastructure — BHW data, censuses, and income classes sit on different PSGC vintages | Not analysis; insurance against silent join loss |

**Tier 2 — high value, moderate friction (license conversation or PDF/format work):**

- **DOH NHFR (health facility registry)** — BHWs per barangay health station/RHU; barangays with
  workers but no facility. Publicly exportable but no stated reuse license → needs a written DOH
  confirmation (piggyback the existing `bhw-2025` relationship). Snapshot load only, no live sync.
- **NNC Operation Timbang Plus** — child malnutrition prevalence (an outcome BHWs directly work
  on, and themselves measure — needs a methodology caveat). Public consolidated downloads at
  region/province; municipal tables may need an NNC request.
- **DOH FHSIS annual reports** — public PDFs (the scoping doc's access fear was too pessimistic),
  service-delivery indicators at province grain, **plus an independent official BHW headcount
  series** for reconciliation against this registry. PDF-extraction cost; no PSGC codes.
- **HDX COD-AB boundaries (`cod-ab-phl`)** — barangay-level (admin-4) boundaries on 2023 10-digit
  PSGC pcodes: effectively the pre-reconciled input for the deferred PMTiles barangay-map work
  (M9). Verify license field on the dataset page.
- **DILG SGLG passers** — governance-quality flag per LGU; PDF/name lists, annual. Marginal;
  only if a governance angle is wanted.

**Tier 3 / watchlist — blocked, license-incompatible, or weak fit:**

- **CBMS 2024** — potentially the richest barangay-level socioeconomic source; no open release
  channel yet. Watch for PSA statistical releases.
- **DOH NDHRHIS/HHRDB HRH data** — would enable "BHWs per nurse/midwife/doctor"; dashboard/login
  only, no bulk export. Bundle into the same DOH conversation as NHFR/FHSIS.
- **healthsites.io / OSM facilities** — **ODbL share-alike conflicts with CC BY republication**;
  use NHFR instead.
- **PhilHealth accredited-facility lists** — PDFs, no PSGC, high parsing cost; deprioritize.
- **NDHS 2022** — region-level representativeness only; microdata non-redistributable.
- **PSADA microdata generally** (LFS etc.) — explicitly non-redistributable; use only published
  OpenSTAT tables.

### 9.3 Suggested acquisition order

1. POPCEN 2024 + CPH 2020 population (unlocks per-capita everywhere, incl. map indicator M1)
2. SAE 2021 poverty per citymun (the flagship Relationships-view variable)
3. DOF income classification (cheap, pairs with the honorarium equity view, refreshes `dim_geo`)
4. PSGC crosswalk table (alongside 1–3)
5. Open the DOH license conversation covering NHFR + FHSIS + NDHRHIS together
6. OPT Plus / FHSIS extractions; COD-AB boundaries when PMTiles work starts

All Tier 1 items are small static tabular loads — comfortably free-tier, no ongoing sync.

## 10. Prioritized recommendation summary

Effort: **S** ≤ half a day · **M** ≈ 1–2 days · **L** > 2 days. Sequencing is a proposal to
discuss, not a committed plan.

### P0 — Make the map readable and trustworthy (no new data)

| # | Recommendation | Fixes | Effort |
| --- | --- | --- | --- |
| 1 | Legend + disclosed quantile/fixed bins (M3) | XD1, XD2, XE2 | S |
| 2 | Hover tooltips + touch select-then-drill flow (M2, M7) | XD3, XD4, XL2 | M |
| 3 | Cooperative gestures + zoom/reset controls (M6) | XD5 | S |
| 4 | Map ↔ ranked-list linked highlighting (M5) | XD6 | S |
| 5 | Small-N hatching/greying + N in tooltip (M4) | XE3 | S |
| 6 | Map interaction telemetry (M8) + pending indicator on navigation (R7) | XU2, XD7 | S |

### P1 — Give Explore its identity (indicator-first analysis)

| # | Recommendation | Fixes | Effort |
| --- | --- | --- | --- |
| 7 | **Indicator switcher for map + ranked list** (M1) | XE1, XE4 | M |
| 8 | Page reordering around the map; dissolve duplicate big-number cards; labeled strip with glossary terms (R1) | XD8, XD10, XL4 | M |
| 9 | Relationships scatter view across child geos (R4) | XE6 | M |
| 10 | Distribution view for the selected indicator (R3) | XE6 | S–M |
| 11 | Benchmarks, certification + honorarium amount/distribution (tabbed), completeness, full export coverage on Explore (R2) | XE5, XE8, XD9 | M |
| 12 | Compact `GeoSearch` in sidebar + breakdown-picker relabel (R5); map-absence stub at deep levels (R6) | XL1, XL3, XL5 | S |

### P2 — New data (internal first, then external)

| # | Recommendation | Fixes | Effort |
| --- | --- | --- | --- |
| 13 | Surface computed-but-unread fields: training recency, self-reported vs verified accreditation, per-capita rate (R8.1–3) | XE7 | S–M |
| 14 | New internal aggregates: year cohorts, workload distribution, attrition, income-class equity (R8.4) | XE7 | M–L |
| 15 | Tier-1 external loads (POPCEN/CPH, SAE poverty, income class, PSGC crosswalk) feeding the Relationships view and map indicators (§9) | XE6 | L |
| 16 | UX research loop: baseline funnel analysis, intercept question, 3-task moderated tests (XU3, XU6) | XU3, XU6 | S–M (ongoing) |

## 11. Open questions for the owner (before the plan is written)

1. **Identity confirmation.** Agree that Explore becomes the indicator-first analyst workbench
   (§2), with place pages remaining the place-first narrative? This decides items 7–10 and where
   cross-analysis lives.
2. **Map indicator set for v1 of the switcher (M1).** Proposed: % accredited · any-honorarium % ·
   households per BHW · avg years of service · coverage %. Add per-topic training coverage now or
   later?
3. **External data green-light.** Proceed with the Tier-1 bundle (POPCEN/CPH population, SAE
   poverty, DOF income class) as "dataset #2"? And should the DOH license conversation
   (NHFR/FHSIS/NDHRHIS) start now in parallel?
4. **`ROLE` column.** It exists in the raw parquet but was never ingested — is role/designation
   analytically interesting and clean enough to publish as a seventh demographic dimension?
5. **Time-cohort framing.** Comfortable adding registration/accreditation/training year-cohort
   figures under the "2025 snapshot" framing (captions would state "years as recorded in the 2025
   snapshot")?
6. **Sequencing preference.** Ship P0 (map trust) alone first, or P0+P1 as one "new Explore"
   release?
