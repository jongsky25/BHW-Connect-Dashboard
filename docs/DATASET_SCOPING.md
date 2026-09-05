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

- **What it adds:** facility- and program-level health service indicators (immunization coverage,
  maternal health service delivery, morbidity/mortality) — the richest candidate content-wise,
  and a natural fit alongside a BHW workforce dataset since BHWs are often the ones delivering
  these services.
- **License / access:** no public open-data download portal was found in this pass (DOH's 2025
  guidance, DM 2025-0104, formalizes FHSIS *collection and reporting* but doesn't describe a public
  release channel). Likely requires a direct DOH request, similar to how the `bhw-2025`/
  `bhw-stepzero-2026` source data itself was obtained rather than pulled from an open portal.
- **Geo-join:** unclear without seeing an actual extract — FHSIS is facility-based, so geo
  resolution likely depends on how cleanly facility → barangay mapping is captured.
- **Verdict:** highest potential value, highest access uncertainty. Worth pursuing only after (or
  alongside) an NHFR license conversation, since both would need the same DOH relationship.

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
