# Dataset scoping — candidates for dataset #2

**Status:** proposal, not yet built. BHW Connect's `dim_geo`/`dim_dataset` schema (§4.1 of the build
plan) was designed as shared infrastructure for more than one Philippine public-interest dataset —
this document is the first pass at picking what comes next, per §8 2.6.

**Update:** the specific gap that motivated candidate #1 below — a population denominator for
"BHWs per 1,000 residents" — turned out to already be covered. The StepZero quick-count
(`agg_bhw_stepzero_counts`) carries `population`/`households` columns per barangay, rolled up to
every geo level, that were loaded for the total-vs-validated-profiles reframing but never surfaced
in the UI. `bhwPer1000ResidentsFor()` (`lib/db/stepzero.ts`) computes the rate from that existing
column, with no new ingestion pipeline or dataset needed — see `docs/DECISIONS.md`. The PSA
population candidate stays below as a source of truth for future cross-checking (StepZero's
population figures are a self-reported barangay-sheet field, not sourced from an actual census),
but is no longer the blocking gap it was when this document was first written.

Every candidate below is scored on the same three things that actually determine whether it's
buildable on this stack: **license** (can we redistribute derived aggregates under CC BY, same as
`bhw-2025`?), **geo-join** (does it key on PSGC the way `dim_geo` already does, or does it need a
crosswalk?), and **update cadence** (does staying current mean a one-time load or ongoing scraping
work?).

## Candidates

### 1. PSA Census of Population and Housing (barangay population) — **built, as a fallback**

**Status as of 2026-09-06: loaded, but not the primary denominator.** The "Update" note above
already covers why this wasn't the blocking gap it looked like — StepZero's own population column
made "BHWs per 1,000 residents" buildable without it. It was loaded anyway on 2026-07-21 (E4.2,
`docs/DECISIONS.md`) as `psa-popcen-2024` + `psa-cph-2020`, and briefly became the *preferred*
denominator with StepZero as fallback. The owner reversed that on 2026-09-06, final: StepZero's own
self-reported population — the BHW program's own count, on the same barangay roster as the BHW
figures it divides — is preferred again, and this dataset fills in only where StepZero has no
population row for a geo at all, plus serving as a cross-check (`docs/POPULATION_RECONCILIATION.md`
carries the match rates). This is now settled; do not swap the precedence again without a fresh
owner decision.

- **What it adds:** population counts per barangay/citymun/province/region. On its own this isn't
  a BHW dataset — its value is entirely as a **denominator**: "BHWs per 1,000 residents" is a much
  more comparable figure across places of wildly different size than a raw headcount, and it's the
  single most-requested kind of context missing from Phase 1 (a barangay captain today can see
  "42 BHWs here" with no sense of whether that's a lot for the place).
- **License:** PSA's OpenSTAT platform publishes under an open-data license — free to use, reuse,
  and redistribute, consistent with the CC BY 4.0 already used for `bhw-2025`.
- **Geo-join:** keys on PSGC, the same code system `dim_geo` already stores (padded to the same
  fixed widths per §3). This is the only candidate here with a join that's expected to be close to
  friction-free — no crosswalk work like the boundary-file vintage mismatch hit in 1.6.
- **Update cadence:** a full Census of Population and Housing runs roughly once a decade (2020 was
  the most recent), with the possibility of a mid-decade update. A one-time load per publication,
  not an ongoing sync — the cheapest candidate to keep current.
- **Effort:** low. Straightforward tabular data, one `agg_*`-style table
  (`agg_population` or folded into `agg_geo_summary`), and one new field on every relevant figure
  ("X per 1,000 residents") rather than a whole new page.

### 2. DOH National Health Facility Registry (NHFR) — **BUILT** (slug `nhfr-2026-09`)

**Status as of 2026-09-05: this candidate is no longer a proposal.** The September 2026 export is
loaded and published at `/facilities`. See `docs/NHFR_2026_PLAN.md` for the build. Everything
below is the assessment as it stands *after* seeing the actual data — the original entry's two
open questions are both answered, and one of them was answered the other way from what it feared.

- **What it adds:** the master list of health facilities (hospitals, RHUs, barangay health
  stations) with type, ownership, and location — health infrastructure alongside the BHW workforce
  that staffs it. **44,799 facilities across all 18 regions**, of which barangay health stations
  are 27,186.
- **License — settled, and it was already settled here before this load.** The owner decision
  recorded at `docs/EXPLORE_ENHANCEMENT_PLAN.md:19` — *"NHFR/FHSIS: use whatever is publicly
  available online, with citation — no formal license conversation required before use; cite
  source + retrieval date in `/methodology` and `dim_dataset`"* — supersedes this section's
  original "blocked pending written DOH confirmation" verdict, which had gone stale. The owner
  further confirmed (2026-09-05) that the public export is covered by the FOI law. Source and
  retrieval date are carried in `dim_dataset.source_name` and on the section's methodology page.
- **Geo-join — the feared problem does not exist.** The original entry warned that facility
  locations might be free-text addresses needing geocoding, "a real risk of repeating 1.6's
  boundary-vintage crosswalk problem". They are not: every facility carries clean 10-digit PSGC
  codes for region, province, city/municipality and barangay. Verified against the file — all four
  columns truncate losslessly to `dim_geo`'s widths, and every barangay code sits inside its own
  city/municipality (0 exceptions in 44,691). **Barangay coverage is 99.76%**; the 108 facilities
  without one join at city/municipality, which every facility has.
- **Two real geo caveats, neither a blocker.** *Sulu* is filed inconsistently by the source — all
  177 of its facilities are named under Region IX while 152 carry BARMM-vintage codes and 25 carry
  Region IX ones; both resolve onto `dim_geo`'s BARMM placement through the crosswalk rows
  `20260826121200_crosswalk_sulu_region_ix.sql` already seeded, so **no new crosswalk was needed**.
  Separately, `dim_geo` is built from the bhw-2025 parquet alone, so places with facilities but no
  profiled BHW have no row — four districts of Manila (Binondo, San Miguel, Ermita, Intramuros;
  127 facilities) among them. `ingestion/patch_dim_geo_nhfr_gap.py` adds them, following the
  StepZero gap patch.
- **A privacy finding the original entry could not have anticipated.** The export carries contact
  columns, and **18,413 of its 20,194 email addresses are free webmail** — personal addresses of
  individual midwives and proprietors, not institutional contacts. None of the contact or
  street-address columns are ingested. Anything reusing this source should make the same call:
  publishing them would put ~18,000 people's personal contact details into an open dataset.
- **Update cadence — as feared, this is the real ongoing cost.** NHFR is live and continuously
  updated, so what is published is a *snapshot*: the slug carries its month, and refreshing means
  re-exporting and re-running the loader. This remains the most expensive thing about the dataset,
  and it is the reason the slug is dated rather than versioned in place.

### 3. DOH FHSIS (Field Health Services Information System)

**Re-scoped 2026-09-06, with the actual 2025 file in hand.** This entry has now been wrong twice in
the same direction NHFR's was, and the correction is the same each time: check it against the data
rather than against the last person's summary. It is not license-blocked, it is not PDF-only, and
it does carry PSGC codes.

**The rule that governs any FHSIS build, decided by the owner 2026-09-06: never publish FHSIS's BHW
numbers.** The `Active Barangay Health Workers` column is real and it is tempting — it is also a
weaker instrument than the dataset this site already exists to publish. The BHW census
(`bhw-2025`, plus the StepZero quick-count) is the official BHW figure here; FHSIS's headcount is
whatever LGUs happened to report through their RHUs. The two disagree, and where they disagree
FHSIS is wrong, not merely different: it puts NCR at 4,454 active BHWs against 3.6M households, and
Las Piñas at **1**. Publishing that beside this site's own registry would not be a "reconciliation
story" — it would be this site sowing doubt about its own primary dataset using a source it knows
to be under-reported. This supersedes `docs/EXPLORE_PAGE_REVIEW.md:443`, which proposed exactly
that cross-check before anyone had seen the numbers. **Ingest FHSIS for what BHWs work
*alongside* — never for how many of them there are.**

- **License — settled, not a blocker.** FHSIS reports are Philippine government work
  (IP Code, RA 8293 §176: no copyright in works created by government employees in an official
  capacity), the same basis this repo already relies on for the DOF/BLGF income-classification
  table, and already covered by the owner's blanket decision at
  `docs/EXPLORE_ENHANCEMENT_PLAN.md:19` — *"NHFR/FHSIS: use whatever is publicly available online,
  with citation"*. This document's older "likely requires a direct DOH request" verdict never
  applied that decision to FHSIS, exactly as it failed to apply it to NHFR.
- **Access — public, and machine-readable.** The primary source is not the `doh.gov.ph` pages the
  earlier passes kept dead-ending on; it is the DOH's own public Drive archive
  (`https://bit.ly/FHSISPHSannualreports` → folder `16z6srVbGODqmgGHU4_Qg1oDBOglqp_XG`, owned by
  `fhsisreports@doh.gov.ph`, readable with no login). It holds six subfolders — Annual, Quarterly
  and Monthly, each in **Excel as well as PDF**. Annual Excel covers **2018 through 2025**;
  quarterly Excel covers 2025 and 2026. The 2024 release is complete across twelve program areas;
  **2025 is a partial release** — Demographics and Vital Statistics published, the rest pending as
  of this writing. The `data.gov.ph` listing under this name is a 2007–2011 relic; ignore it.
- **Geo-join — clean PSGC, at city/municipality grain.** Verified directly against
  `Demographic_2025_EB_Final.xlsx` (341 KB, 2025 Demographics folder): a `PSGC` column of 10-digit
  codes in the same shape NHFR uses, over **1,743 rows — 18 regions, 115 provinces/HUCs, 1,610
  cities/municipalities**. No name-matching, no OCR, no crosswalk work anticipated. Two handling
  notes found in the file itself: some codes carry a trailing `.0` from Excel's float coercion and
  need normalising, and the workbook's two header rows are merged, so the column map has to be
  built from the group row plus the sub-header row rather than a single header line.
- **What it adds, given the BHW rule.** Per city/municipality, from the Demographics workbook
  alone: **population** and **household estimates** (a real denominator — the site currently leans
  on StepZero's *self-reported* household figures), and the rest of the public health workforce —
  doctors, nurses, midwives, dentists, medical technologists, nutritionists, sanitary
  engineers/inspectors — each split LGU-hired versus DOH-hired. That last part is the
  "BHWs per midwife / per doctor" context `docs/EXPLORE_PAGE_REVIEW.md` filed as blocked on
  NDHRHIS (dashboard-only, no bulk export); FHSIS supplies it in a spreadsheet, with this site's
  own census as the BHW numerator. A companion sheet carries barangay, RHU and BHS counts, and the
  other program folders carry the service-delivery indicators (immunisation, maternal care,
  infectious disease, environmental health) that were this candidate's original attraction.
- **Plan: `docs/FHSIS_2025_PLAN.md`** (2026-09-06) — year fixed at 2025 by the owner, the BHW rule
  carried as its Decision 2, first slice = the PSGC-keyed city/municipality tier.
- **Verdict: promoted — this is a ready tabular load, not a PDF-extraction project.** The effort
  question this section has carried for months is answered: there is nothing to extract. What
  remains is ordinary increment work (pick the year, pick the program areas, load, aggregate,
  cite), plus one judgment call worth making deliberately — 2025 is only partly released, so a
  build either takes complete-2024 or takes partial-2025 and states the gap. The one thing a build
  must not do is republish the BHW column.

### 4. PhilAtlas-style reference sites

- Not a dataset in the same sense as the three above — these are established reference/lookup
  sites for Philippine administrative geography and demographics, useful for **cross-checking**
  figures (e.g. sanity-checking a StepZero drift, as already done for the 277,767 vs. 278,240 DOH
  reconciliation in `/methodology`) rather than as a table to ingest and publish. No action item
  here beyond continuing to use them informally for QA, as the project already implicitly does.

## Recommendation

~~**Build the PSA population candidate first.** It's the only one with a confirmed open license and
a PSGC join that should require no new crosswalk work, it's a one-time load rather than an ongoing
sync, and "per-capita" framing is a genuine, frequently-requested gap in the current dashboard —
not a speculative nice-to-have. Suggested `dim_dataset` slug: `psa-population-2020`.~~ **Superseded:
built 2026-07-21** as `psa-popcen-2024` + `psa-cph-2020` (§1 above), and settled into its final role
— StepZero-preferred, census-fallback — on 2026-09-06.

~~NHFR and FHSIS both stay on the roadmap as higher-value, higher-effort follow-ups once DOH
access/licensing questions are resolved.~~ **Superseded: NHFR shipped 2026-09-05** as
`nhfr-2026-09` (§2 above), on the public-with-citation basis
`docs/EXPLORE_ENHANCEMENT_PLAN.md:19` had already established. FHSIS remains open, and the reason
this document gave for bundling the two — that both need the same DOH relationship — turned out
not to apply to NHFR, whose export is simply public. FHSIS may well be the same; it is worth
re-checking on its own terms rather than inheriting NHFR's old blocked verdict.

**That re-check happened 2026-09-06 (§3 above), and it moved FHSIS up, not sideways.** Access was
never the blocker — same RA 8293 §176 basis, same owner decision, already covering it. More to the
point, the "PDF-extraction cost" this document treated as FHSIS's defining problem does not exist:
DOH publishes the annual and quarterly reports as **Excel**, PSGC-keyed, down to city/municipality,
in a public Drive archive nobody in the previous passes had found because they were searching the
`doh.gov.ph` web pages instead. **FHSIS is now a ready tabular load on the same footing as the PSA
candidate**, and its Demographics workbook happens to carry population *and* household estimates
per city/municipality — overlapping much of what candidate #1 was wanted for, in one download.
Either could go first; FHSIS covers more ground per unit of work, PSA is the more authoritative
population source (FHSIS's population column is a projection carried for ratio arithmetic, not a
census). The build rule from §3 travels with it: **never publish FHSIS's BHW counts** — the census
in this repo is the official BHW figure.

**A lesson worth keeping.** This section carried "blocked on a license answer before any ingestion
work starts" for months after an owner decision elsewhere in the docs had unblocked it, and
carried a geo-join risk that thirty minutes with the actual file disproved. A scoping verdict is
only as current as the last time someone checked it against both the other decisions in the repo
and the data itself.

## Also deferred (documented, not built) — per §8 2.6

- **Barangay-level map polygons (PMTiles).** Phase 1 ships city/municipality-level choropleths
  only (1.6, pitfall P11 — 39K barangay polygons don't fit the free-tier budget as flat GeoJSON).
  The upgrade path is PMTiles: pre-tiled, single-file vector tiles served as static byte-range
  requests (no tile server needed — Vercel's static hosting + a range-request-capable client
  library like `pmtiles`'s MapLibre protocol handler is sufficient), keeping the "free tiers only"
  constraint intact. This needs its own boundary-vintage reconciliation pass (like 1.6, but at
  barangay grain) before it's worth starting.
- **Open API design.** `/api/export/csv` already doubles informally as a public API for
  researchers (§4.4). A proper public API would mean: stable versioned routes under `/api/v1/`,
  documented query parameters (mirroring the existing filter codec in `lib/filters/schema.ts`),
  and a rate limit distinct from the per-session usage-event throttling used for chat (2.4) — sized
  for programmatic callers, not browser sessions. Not built here; flagged as a natural next step
  once there's evidence of real external demand (e.g. via the `/feedback` "suggest a dataset" flow
  this same increment updated `/roadmap` to invite).
