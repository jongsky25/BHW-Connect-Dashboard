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

### 1. PSA Census of Population and Housing (barangay population) — recommended

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

**Re-scoped 2026-09-06, no data file in hand yet.** This candidate's access verdict was wrong in
the same direction NHFR's was: "highest access uncertainty" was a *format* problem mistaken for a
*permission* problem. It is not license-blocked. What it actually needs before a build plan can be
written, unlike NHFR, is a human downloading one real PDF in a browser — every `doh.gov.ph`
subdomain returns HTTP 403 to automated fetchers from this environment (confirmed directly; the
same block `docs/EXPLORE_PAGE_REVIEW.md` already recorded for PSA/DOH/HDX sites in general), so the
findings below come from independent secondary sources (GHDx's catalog entry, the FOI portal, and
regional CHD office listings), not from opening an actual report.

- **What it adds:** annual tables on notifiable diseases, leading causes of morbidity/mortality,
  births, immunization, dental health, family planning, maternal/child nutrition, health
  facilities, and health care personnel — **including a "Ratio of Health Care Workers to
  Population" table that carries an Active BHW count**, independent of this project's own
  profiling data. That is exactly the second, official BHW headcount series
  `docs/EXPLORE_PAGE_REVIEW.md` flagged for reconciliation against `bhw-2025` — a second
  277,767-vs-278,240-style cross-check story (`/methodology` already has the pattern), not a new
  kind of finding for this codebase.
- **License — settled, not a blocker.** FHSIS reports are Philippine government work
  (IP Code, RA 8293 §176: no copyright in works created by government employees in an official
  capacity), the same basis this repo already relies on for the DOF/BLGF income-classification
  table. This is also already covered by the owner's blanket decision at
  `docs/EXPLORE_ENHANCEMENT_PLAN.md:19` — *"NHFR/FHSIS: use whatever is publicly available online,
  with citation"* — which this document's older "likely requires a direct DOH request" verdict
  failed to apply to FHSIS, exactly as it failed to apply to NHFR before that build corrected it.
- **Access — public, but PDF-only.** National annual reports are posted at
  `doh.gov.ph` (Publications → Serials → Health Reports and Statistics → FHSIS Annual Reports),
  confirmed for at least 2014–2023; several regional Centers for Health Development (Ilocos,
  CALABARZON, Soccsksargen, Western Visayas among them) separately publish their own regional
  editions, with 2024 regional editions already appearing before a consolidated national one was
  found. No bulk/tabular export exists at the primary source — reports are PDF only. A dataset
  titled `field-health-services-information-system-fhsis` does exist on the Open Data Philippines
  portal (`data.gov.ph`) with at least one CSV resource, but the only date range found associated
  with it is 2007–2011 (via a search snippet, not opened directly — `data.gov.ph` renders its
  dataset pages client-side and this session's tools could not render or fetch the resource
  itself); treat it as probably stale until a human confirms otherwise in a browser.
- **Geo-join — better than feared, still unverified in an actual table.** GHDx's series
  description states tables are broken down by **region, province, and city** — a finer grain than
  `docs/EXPLORE_ENHANCEMENT_PLAN.md`'s E4.6 assumed ("province grain"). Whether "city" means every
  city/municipality or only HUCs, whether names are clean enough for a name-match join to
  `dim_geo` (the DOF/BLGF table's precedent) or carry an older naming vintage, and — the single
  biggest swing factor on effort — **whether the PDF text is extractable or the tables are scanned
  images needing OCR**, all require opening a real PDF. None of that can be answered from outside
  a browser.
- **Verdict: access is no longer the blocker; extraction cost is the open question, and it's now
  cheap to answer.** The next actionable step is small: a human downloads one recent national (or,
  failing that, one regional CHD) FHSIS annual report PDF in an actual browser and drops it under
  `ingestion/data/`. That one file settles the extraction-cost question this section can't, the
  same way obtaining the actual NHFR export — not a license letter — is what actually unblocked
  that candidate. Until then this stays a proposal, not a plan: `docs/EXPLORE_ENHANCEMENT_PLAN.md`
  §E4.6 already names the fallback if extraction turns out unreliable ("skip, document instead"),
  which is the right posture to keep.

### 4. PhilAtlas-style reference sites

- Not a dataset in the same sense as the three above — these are established reference/lookup
  sites for Philippine administrative geography and demographics, useful for **cross-checking**
  figures (e.g. sanity-checking a StepZero drift, as already done for the 277,767 vs. 278,240 DOH
  reconciliation in `/methodology`) rather than as a table to ingest and publish. No action item
  here beyond continuing to use them informally for QA, as the project already implicitly does.

## Recommendation

**Build the PSA population candidate first.** It's the only one with a confirmed open license and
a PSGC join that should require no new crosswalk work, it's a one-time load rather than an ongoing
sync, and "per-capita" framing is a genuine, frequently-requested gap in the current dashboard —
not a speculative nice-to-have. Suggested `dim_dataset` slug: `psa-population-2020`.

~~NHFR and FHSIS both stay on the roadmap as higher-value, higher-effort follow-ups once DOH
access/licensing questions are resolved.~~ **Superseded: NHFR shipped 2026-09-05** as
`nhfr-2026-09` (§2 above), on the public-with-citation basis
`docs/EXPLORE_ENHANCEMENT_PLAN.md:19` had already established. FHSIS remains open, and the reason
this document gave for bundling the two — that both need the same DOH relationship — turned out
not to apply to NHFR, whose export is simply public. FHSIS may well be the same; it is worth
re-checking on its own terms rather than inheriting NHFR's old blocked verdict.

**That re-check happened 2026-09-06 (§3 above): FHSIS is the same story.** Public domain by the
same RA 8293 §176 basis, already pre-approved by the same owner decision, and the "highest access
uncertainty" this section gave it was really an unverified PDF-extraction-cost question wearing a
licensing costume. It still isn't recommended ahead of PSA population, though — PSA is a ready
tabular load with a confirmed-clean PSGC join, while FHSIS's effort hinges on a PDF-extraction
question nobody has answered yet (native text vs. scanned, and how clean the province/city names
are), which needs one actual report in hand before it can be scoped further, the same way NHFR's
own scope firmed up only once its export file was.

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
