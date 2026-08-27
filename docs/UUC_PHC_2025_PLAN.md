# UUC for PHC 2025 — Unserved and Underserved Communities (handoff document)

A dedicated dashboard card and section for the **2025 list of Unserved and Underserved
Communities for Primary Health Care**, built from `ingestion/data/Submissions_UUA_2025_filled_1.xlsx`.

**Status:** **the dataset is shipped; the section is not yet at parity.** U1 through U4 landed
2026-08-26 (PR #75): the 5,991 rows are loaded, rolled up to every geo level, rendered at `/uuc-phc`
from national down to city/municipality with each listed barangay showing the factors it qualified
on and its health indicators (capped values marked), and every area has a downloadable PNG
one-pager. Feature write-up: `docs/uuc-phc-feature.md`.

**U5 and U6 landed 2026-08-26; U7 and U8 landed 2026-08-27** — the registry/lineage debt is
cleared, the ERROR-level advisor finding is closed, both `/uuc-phc` routes present, route their
feedback by dataset and carry social cards, `/uuc-phc/criteria` answers *why* each barangay
qualified as four overlapping shares rather than a partition, and the section now has its own
grounded chat and AI insight slot, scoped so neither can answer from the BHW census. U9 through
U12 remain. **All four of §8's defects are closed**: defect 1 in U6, defects 2 and 3 in U8 (which
found a third place with the same hole — the answer-bank refresh — and a second hole in the
near-match path that the cache key alone did not close), and defect 4 is routed around by U5's
registry.

**What this revision adds (2026-08-26): U5 through U12**, bringing the section up to the shape the
2025 BHW Census section already has — present mode, ask-the-data chat, an AI insight slot,
dataset-aware feedback, and sub-pages that show the data at levels the current two-page drill-down
cannot reach. It also plans the `/explore` overlay U4 left as the one unbuilt idea, and clears the
registry/lineage debt that two concurrently-merged branches left behind. See §8–§10.

**Verdict on scoping: build this outside `AI_ASSISTANT_PLAN.md`.** It is a normal dataset
increment on the path that already exists — ingest → `dim_dataset` → fact → aggregate → card —
exactly as `bhw-profiling-status-2026` was built (`docs/profiling-status-feature.md`). It needs
no registry, no embeddings, and no graph. The AI plan's §5 decision #6 settles the aggregate
question in this dataset's favour: a new dataset ships with facts and a dictionary only, and
earns materialized aggregates *when a dashboard page renders it*. This one renders, so it does.

The **2027 Budget Cue Cards** PDF loaded alongside it is the opposite case and belongs squarely
inside the AI plan — see `AI_ASSISTANT_PLAN.md` §12.

---

## 1. Naming

The two files use three names for one thing. Settle on the policy name:

| Term | Meaning | Where |
|---|---|---|
| **UUC for PHC** | Unserved and Underserved Communities for Primary Health Care | Cue cards p48 — the program's own name |
| UUA | Unserved and Underserved Areas | The Excel's `DECISION` column values |
| GIDA / SEDA | Geographically Isolated and Disadvantaged Areas / Socio-Economically Disadvantaged Areas (urban poor) | Former names, superseded (cue cards p48) |

Policy basis: **DOH AO No. 2020-0023** defines the criteria (§1a below); **DC No. 2025-0549**
issues the 2025 list (cited on cue cards p37).

Proposed slug **`uuc-phc-2025`**, `geo_join_level = 'barangay'`, `as_of_date = 2025-01-01`.
Keep `UUA` only as the raw column value inside the fact table, never in UI copy.

---

## 1a. Where the criteria come from

`ingestion/data/DOH_AO_2020-0023_GIDA_guidelines.pdf` — *Guidelines on Identifying
Geographically-Isolated and Disadvantaged Areas and Strengthening their Health Systems*, signed
27 May 2020 by Sec. Francisco T. Duque III. Issued under RA 11223 (UHC Act) IRR §29.2, which
mandates the DOH to develop guidelines for identifying GIDA barangays; it repeals AO 185 s. 2004.

**This document is why the dataset has the shape it has.** Every assessment column in the
workbook is a criterion from §VI.A, and every threshold below was verified against the file
itself, not inferred.

A barangay qualifies only if **both** a physical **and** a socio-economic factor are present.

**Physical factor** — at least **25%** of sitios/puroks have no access to an RHU or hospital
within **60 minutes** of travel in any form of transport, *including walking*.

**Socio-economic factor** — at least **one** of:

| # | Condition | Workbook column |
|---|---|---|
| a | ≥ 10% of population are IPs | `IP POP` → `IP POPN` |
| b | ≥ 10% affected by armed conflict or internally displaced, **or** the barangay is designated a CTG/LEG area by NICA | `ARMED CONF`, `IDP` → `AC/ IDP`; `ELCAC BRGY` → `ELCAC PASS` |
| c | ≥ 50% of population enrolled in 4Ps/CCT | `4PS` → `4Ps/CCTs` |
| d | Performs worse than the **latest provincial data** on at least **4 of 8** health indicators | the seven `* Prov Ref` / `High or Low*` pairs → `Health Indicators` → `HI` |

The eight indicators under (d) are: Infant Mortality Rate, Under-Five Mortality Rate, Fully
Immunized Child, Adolescent (10–19) Birth Rate, **Contraceptive Prevalence Rate**, proportion of
pregnant women with 4+ pre-natal visits, proportion of deliveries with a skilled birth attendant,
and households with access to improved water supply.

### What this explains

- **The `* Prov Ref` columns are the AO's provincial comparators.** They are not barangay
  measurements and must never be cleaned as if they were — §2 of the cleaning report holds.
- **`Health Indicators` (0–7) is the AO's count under (d)**, and `HI` passes at ≥ 4. Verified: the
  score equals the number of `High or Low*` columns reading `Pass` in all 5,991 rows.
- **`Physical Factor` has a floor of 25 and every row passes**, because the file is the
  *post-selection* list — barangays below 25% never entered it.
- **The units the owner set match the AO's own definitions.** IMR, UFMR and ABR are rates; FIC,
  pre-natal, SBA and water are proportions. The cap-at-100 / cap-at-1,000 split follows the policy,
  not a convention chosen here.

### Two discrepancies worth recording

**FP CU is the AO's Contraceptive Prevalence Rate** — criterion (d)(v). Its removal from the
reconciled file leaves **7 of the AO's 8 indicators**, while the `≥ 4` threshold appears unchanged.
Four-of-seven is a stricter test than four-of-eight. It does not affect this list, which is already
selected, but it matters for the next profiling round and should be settled with BLHSD before then.

**Criterion (b) is implemented as a sum, not an either/or.** The file marks `AC/ IDP` as Pass when
`ARMED CONF + IDP ≥ 10`, matching all 5,991 rows; reading the AO's "or" as either-alone disagrees
on 15. Summing double-counts anyone both conflict-affected and displaced. Minor, but it is an
implementation choice rather than the text of the order.

### The provincial reference table

Criterion (d) is a *comparison*, so it needs a benchmark per province. Those benchmarks arrived
embedded in the reconciled workbook as the seven `* Prov Ref` columns, repeated identically down
all 5,991 rows. Extracted to one row per province as
`ingestion/data/uuc_phc_2025_provincial_reference.csv` (**88 provinces/HUCs**) and as the
*Provincial reference* sheet of the cleaned workbook.

The table is structurally sound — **zero contradictions**: every barangay in a province carries
the identical reference value, so the denormalised form was consistent.

**The benchmarks have the same units problem as the barangay data, one level up.** Before
correction, 26 provincial values were impossible as proportions:

| Indicator | Provinces > 100 | Worst | Treatment |
|---|---:|---|---|
| Water | 16 | Oriental Mindoro 365.5 | **Capped at 100** |
| Pre-natal | 8 | Tarlac 166.0, Pangasinan 143.9 | **Capped at 100** |
| FIC | 2 | Ilocos Sur 102.15, City of Butuan 101.00 | **Left as supplied** |
| ABR | 1 | Samar 277 | Left — a rate per 1,000, legitimately above 100 |

24 values across 22 provinces were capped (Aurora and Bulacan had both).

**Why this matters beyond tidiness.** Criterion (d) marks a barangay as meeting the GIDA test when
it performs *worse* than its province. An inflated benchmark flips that test on automatically:
with Oriental Mindoro's water reference at 365.5 and no barangay value able to exceed 100, **every
barangay in the province read as worse than its province on water**, pushing the `Health
Indicators` count toward the ≥ 4 threshold. Qualification was therefore easier in the affected
provinces than in the rest. Capping removes that skew for Water and Pre-natal.

**FIC is deliberately not capped here**, so Ilocos Sur (102.15) and City of Butuan (101.00) remain
above 100 while barangay FIC values are capped at 100. In those two provinces no barangay can
exceed its benchmark, so all of them read as worse than province on FIC. The effect is confined
to 2 provinces and the excess is under 3%, but it is a live inconsistency rather than a resolved
one.

**Five provinces have references that cannot support the comparison at all** — 226 barangays, 4%
of the list:

| Province | Barangays | Problem |
|---|---:|---|
| Agusan del Sur | 156 | Every reference is exactly `1` — a placeholder, not a measurement |
| Nueva Vizcaya | 50 | No reference at all (`#N/A`) |
| Cagayan | 12 | Every reference is `0` |
| Zamboanga City (HUC) | 7 | No reference at all (`#N/A`) |
| Special Geographic Area (BARMM) | 1 | All values below 1 — recorded as fractions, not percentages |

*(Corrected in U7 from 238, which this document and `UUC_PHC_2025_CLEANING_REPORT.md` §6 both
carried: the five per-province figures above have always been right and sum to 226.
`agg_uuc_phc_criteria` computes the figure — `n_listed - n_health_evaluable` — rather than
quoting it, so it cannot drift again.)*

For these, criterion (d) is not evaluable. It does not invalidate their inclusion — the
socio-economic test passes on any one of four routes — but any analysis that leans on the
health-indicator comparison should exclude them.

### Cadence

CHDs and LGUs conduct mandatory profiling **once every three years** (§VI.B.6); BLHSD issues the
official list **annually** (§VI.B.2). So the dataset has two different refresh rhythms — the
underlying profile and the published list — which the dashboard's `as_of_date` should reflect.

---

## 2. What is in the workbook

Ten sheets. Two carry the payload; the rest are working copies that disagree with each other.

**Use these:**

| Sheet | Rows | Content |
|---|---|---|
| `NEW` | 15,386 | Region / province / citymun / barangay + `DECISION`. **UUA 5,991, NOT UUA 9,395.** The classification of record. |
| `2025 LIST` | 6,024 body rows (5,991 with a PSGC) | The 5,991 UUC-for-PHC barangays with 13 indicator columns. |

**Ignore these, and why:**

- **`Analytics`** — every computed cell is `#REF!`. It also measures something else entirely:
  *profiling coverage* against a 40,397-barangay target, which is the concept the
  `bhw-profiling-status-2026` card already serves. Do not ingest it and do not rebuild it here.
- **`PSGC (2)`** (5,602 distinct UUA) and **`PSGC DOC AC`** (5,917 distinct UUA) — lossy copies
  that disagree with `NEW`'s 5,991. `PSGC (2)` holds 15,390 rows but only 13,564 distinct
  barangay codes, so it is duplicated as well as incomplete.
- **`Sheet5`** (40,296 barangays) and **`PSGC`** (43,451) — PSGC masters, superseded by `dim_geo`.
- **`2024 ELCAC (2)`** and **`2021-2024 ELCAC`** — identical to each other, header on row 2, two
  unaligned column blocks side by side. Out of scope for this dataset.

`Sheet1` is a pivot of `NEW` and needs no separate handling.

---

## 3. Reconciliation against the cue cards

Cue cards p37 publishes *Distribution of UUC for PHC Barangays by Region (as of 2025 per DC No.
2025-0549)*. The workbook reproduces it almost exactly — **15 of 17 regions match to the unit**:

| Region | Cue cards p37 | Workbook `NEW` | Δ |
|---|---:|---:|---:|
| BARMM | 400 | 399 | **−1** |
| Region IV-A (CALABARZON) | 195 | 200 | **+5** |
| *Other 15 regions* | *exact match* | *exact match* | 0 |
| **Total** | **5,987** | **5,991** | **+4** |

Two localized discrepancies, no systemic drift.

**The workbook is internally consistent; the deck is the outlier.** Three independent places in
the workbook agree on both contested figures — the `NEW` classification sheet, the row count of
`2025 LIST`, and the `TOTAL` subtotal rows embedded in `2025 LIST` (§4) — all give CALABARZON 200
and BARMM 399. There is no counting artifact on the workbook side to find.

That makes the likeliest reading a **vintage difference**: p37 is a published snapshot "as of 2025
per DC No. 2025-0549", and the file is named `Submissions_UUA_2025_filled_1`, which reads as a
later revision. This is inference from the file name and the internal agreement, not something
either file states — confirm it rather than assuming it.

**Decision — confirmed by the owner:** publish the workbook's **5,991** as the card's figure, and
footnote p37's 5,987 with its circular reference and as-of date. The
deck is what has been briefed to budget audiences, so the footnote is not optional — but a
dashboard should render its own source, and that source corroborates itself three times. Record
the decision and the two affected regions in `DECISIONS.md`, following
`POPULATION_RECONCILIATION.md` and `BOUNDARY_RECONCILIATION.md`.

---

## 4. Geography — joins cleanly, with one known exception

The good news: `dim_geo` holds **41,958 barangays keyed on 10-digit codes**, and `2025 LIST.PSGC`
is already 10-digit. No crosswalk work is needed for the bulk of the file.

*Verified:* a random sample of 150 of the 5,991 codes joined **148/150** against
`dim_geo` at `geo_level='barangay'`. Both misses were Sulu.

**The Sulu exception.** 87 codes carry the prefix `09066` — Sulu under **Region IX**, following
its 2024 removal from BARMM. `dim_geo` still holds Sulu as **`19066`** under region 19 (410
barangays, `psgc_vintage = '2023 series (>=2024 release, includes NIR)'`).

**Correction (found while loading U1): the workbook does not file Sulu under Region IX — only its
codes do.** All 87 Sulu rows carry `region_name = BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO
(BARMM)` and `province_name = SULU` while carrying `09066…` codes. The file is internally
inconsistent about Sulu: the name column says BARMM, the code column says Region IX. So an earlier
draft's "p37's Region IX count of 523 includes Sulu" was **wrong** — the workbook's 523 Region IX
rows are Zamboanga Peninsula alone, and Sulu's 87 sit inside BARMM's 399.

**This decides which side the rollups take, and the answer is the reassuring one.** Resolving
`09066… → 19066…` through the crosswalk puts Sulu under BARMM in `dim_geo`, which is what the
workbook's own region column says. Verified live after the U1 load: grouping the 5,991 rows by
`dim_geo.region_code` reproduces the workbook's regional table at **all 17 regions**, BARMM 399 and
Region IX 523 included, with no adjustment. Honouring the *code's* region instead would give Region
IX 610 / BARMM 312 and break the §3 reconciliation.

The remap is mechanical: region digits `19` → `09`, province and barangay digits unchanged
(`19066NNBBB` → `09066NNBBB`). **Do it as `dim_psgc_crosswalk` rows, not as a hand-edit of
`dim_geo`.** That table exists for exactly this, and `AI_ASSISTANT_PLAN.md` §3 names it the model
every later entity-resolution problem should follow. A silent `dim_geo` edit would also
retroactively move every existing BHW figure for Sulu between regions.

### The 33 codeless rows — 32 are not barangays

An earlier draft of this document recorded "~33 rows with a barangay name but no PSGC, needing
codes or exclusion." That was wrong, and the correction matters for the loader.

**32 of the 33 are layout, not data**: 16 region-header rows (region name in column A, everything
else empty) and 16 `TOTAL <count>` subtotal rows embedded between the regional blocks. A loader
that reads `2025 LIST` as a flat table ingests all 32 as barangays. Skip any row whose column A is
`TOTAL` or whose PSGC and citymun are both empty.

Those subtotal rows are useful in their own right — they are the workbook stating its own regional
counts, and §3 uses them as a third independent check.

**One row is a genuine missing code:** `SORSOGON / PILAR / SAN ANTONIO`. It cannot be resolved
automatically — PSGC has **two** barangays named SAN ANTONIO in Pilar, Sorsogon (`0506213047` and
`0506213048`), neither already present in the list, and the workbook carries no field that
distinguishes them. This one needs the source office. It is 1 barangay in 5,991.

---

## 5. The indicators are not ready to publish

`2025 LIST` carries 13 indicator columns. Five are clean; **eight are not**.

| Column | Observed range | Read |
|---|---|---|
| Physical Factor (% of puroks >1hr from RHU) | 0 – 100 | clean, percentage |
| IP POP | 0 – 100 | clean, percentage |
| ARMED CONF | 0 – 100 | clean, percentage |
| IDP | 0 – 100 | clean, percentage |
| 4PS | 0 – 100 | clean, percentage |
| IMR | 0 – **3,000** | out of range |
| UFMR | **−2** – **3,000** | out of range, negative |
| FIC | 0 – **18,088** | out of range |
| ABR | **−2** – **1,429** | out of range, negative |
| FP CU | 0 – **11,072** | out of range |
| Pre-natal | 0 – **1,950** | out of range |
| SBA | **−1** – 300 | out of range, negative |
| Water | **−1** – **9,594** | out of range, negative |

**This is not a scatter of typos.** Counting how many of the 5,991 barangays exceed 100 in each
column shows the problem is structural:

| Column | > 100 | share | < 0 | Maximum |
|---|---:|---:|---:|---|
| FP CU | 1,043 | 17.4% | 0 | 11,072 — San Isidro, City of San Jose del Monte, Bulacan |
| Water | 902 | 15.1% | 1 | 9,594 — Demang, Sadanga, Mountain Province |
| FIC | 457 | 7.6% | 0 | 18,088 — Villamiemban, Cordon, Isabela |
| Pre-natal | 211 | 3.5% | 0 | 1,950 — Borlongan, Dipaculao, Aurora |
| ABR | 100 | 1.7% | 6 | 1,429 — Nadawisan, Cataingan, Masbate |
| UFMR | 80 | 1.3% | 7 | 3,000 — Sua, Masantol, Pampanga |
| IMR | 60 | 1.0% | 0 | 3,000 — Sua, Masantol, Pampanga |
| SBA | 29 | 0.5% | 1 | 300 — Guitol, Santa Elena, Camarines Norte |

Two hypotheses worth putting to the source office directly, since they imply different fixes:

1. **Mixed units inside one column.** At 17% and 15%, FP CU and Water look like some encoders
   entered a raw count and others a percentage of the same denominator. If so the column is
   recoverable — with the denominator, per row.
2. **Negatives are "no data" sentinels.** The `−1` and `−2` values are few (15 in total across
   four columns) and sit exactly where a sentinel convention would put them. If confirmed they
   map to NULL, not to a value.

Neither is safe to assume. Publishing these columns unresolved would put unexplainable figures on
a public page — and silently coercing 17% of a column would be worse.

**This does not block the card.** The classification (*which* barangays are UUC for PHC) is
clean, is the part the cue cards actually publish, and is the part with a policy citation. Ship
that first; hold the indicators for U3 pending a per-column units confirmation from the source
office.

---

## 6. Proposed increments

Mirrors `bhw-profiling-status-2026`. Each is independently shippable and must pass its Verify.

**U1 — Classification, national. Shipped 2026-08-26.**

**Scope narrowed by the owner: only the 5,991 listed barangays load.** The workbook's 9,395
`NOT UUA` rows are not ingested, so `fact_uuc_phc_barangay` carries no `decision` column —
membership is presence, and it would read `UUA` on every row. Anything needing "share of barangays
in this area" takes its denominator from `dim_geo`'s complete 41,958, not from the workbook's
partial assessed set. This also retires a gap that would otherwise have needed solving: the `NEW`
sheet carries no PSGC column at all, and name-matching its `NOT UUA` rows against `dim_geo` leaves
**769 of 9,395 unresolved** (mostly BARMM — Tawi-Tawi, Basilan, Lanao del Sur).

Shipped as:

| Artefact | What it is |
|---|---|
| `20260826121000_fact_uuc_phc_barangay.sql` | Table: `geo_code`, `source_geo_code`, `source_region/province/citymun/barangay`; RLS public-read |
| `20260826121100_seed_dim_dataset_uuc_phc.sql` | `dim_dataset` row, slug `uuc-phc-2025`, `geo_join_level = 'barangay'` |
| `20260826121200_crosswalk_sulu_region_ix.sql` | Sulu vintage map, derived FROM `dim_geo` — all 430 Sulu geos, not just the 87 needed |
| `20260826121300_seed_fact_uuc_phc_barangay.sql` | 5,991 rows, generated |
| `ingestion/ingest_uuc_phc.py` | Loader; reads the cleaned CSV, checks it, emits the seed |
| `ingestion/data/uuc_phc_2025_cleaned.csv` | Committed machine-readable extract the loader reads |

Two implementation notes worth keeping. **The seed resolves `geo_code` in SQL**, through
`map_psgc_to_dim_geo(source_geo_code, …)`, rather than remapping Sulu in Python — so a missing
crosswalk row fails the insert on `geo_code`'s `NOT NULL` instead of silently dropping barangays,
and the remap lives in one place. **The 32 layout rows need no handling**: the loader reads the
cleaned CSV, not `2025 LIST`, and the cleaning step already dropped them. San Antonio, Pilar is
resolved (`0506213048`), so nothing is held back.

*Verify — all green, run live against the loaded table:*

| Check | Result |
|---|---|
| Rows loaded | **5,991** (= 5,991 distinct `geo_code`) |
| Every `geo_code` resolves in `dim_geo` | **0 unresolved** — §4's 150-row sample is now exhaustive |
| Every row is barangay-level | **0 non-barangay** |
| Sulu remapped | **87**, each exactly `09066…` → `19066…` |
| Regional counts vs §3 | **17 of 17 exact**, total 5,991 |
| Crosswalk rows seeded | **430** (1 province + 19 citymuns + 410 barangays) |

The loader re-checks the extract before emitting: row count, PSGC format, duplicates, `UUA`-only,
the 87-code Sulu count, and all 17 regional counts — each a hard failure, since a silently short
load is worse than a failed one when 5,991 is a headline figure.

**U2 — Aggregates and the section. Shipped 2026-08-26.**

`agg_uuc_phc_counts` keyed `(dataset_id, geo_code, geo_level)`, **1,788 rows** at national /
region / province / citymun. Two columns — `n_listed` and `n_barangays` — with the share derived
in the read layer, since a membership list is one count against one denominator rather than a
measurement.

Three choices worth recording:

- **Computed in SQL from the fact table + `dim_geo`, not from a generated seed.** Re-running the
  migration recomputes every row, so the aggregate cannot drift from the facts and re-running *is*
  the refresh procedure.
- **A row for every geo, including those with none listed.** NCR reads "0 of 1,675" with an
  explicit note, rather than rendering as "no data". This list is a single national publication, so
  a zero is a result — the opposite of the profiling-status section, whose region-by-region rollout
  genuinely does have not-yet-loaded areas.
- **No barangay-level rows.** 41,958 rows of `n_listed` in {0,1} would restate the fact table; a
  city/municipality page reads its own barangays from `fact_uuc_phc_barangay` and names each one's
  status. `/uuc-phc/barangay/*` therefore 404s.

*Verify — all green:*

| Check | Result |
|---|---|
| Aggregate rows | **1,788** (1 + 18 + 118 + 1,651) |
| National | **5,991** of 41,958 |
| Σ regions / Σ provinces / Σ citymuns | **5,991** each |
| Province == Σ its citymuns; region == Σ its provinces | **0 mismatches** |
| `n_listed > n_barangays` anywhere | **0** |
| Regions reading zero | **1** (NCR) |

Rendered pages were checked against live data at every level — national, region, province, a
fully-listed city (MAYOYAO 27 of 27), a mixed one (BANGUI 2 of 14) and a zero region (NCR) — plus
404s for unknown geos and barangay URLs. See `docs/uuc-phc-feature.md`.

**U3 — Indicators. Shipped 2026-08-26.**

`fact_uuc_phc_indicators`, one row per listed barangay: 12 indicators (not 13 — FP CU was dropped
before reconciliation), the 7 provincial benchmarks criterion (d) compares against, and
`capped_indicators` naming which of that barangay's values were bounded during cleaning.

**The display rule §7 asked for, resolved: mark the value, and never average it.** A capped value
is a ceiling the source overshot, so it carries a † wherever it is rendered, with a footnote saying
the true figure is unknown. That mark can travel with one rendered value but cannot survive a mean,
which is why this increment adds **no per-indicator aggregates** — the plan's original "aggregates
only for those a page renders" resolves to *none*. An average water figure would absorb 886
ceilings and report near-universal coverage the source does not support.

Two things the build found that the plan had not:

- **A benchmark can be impossible.** FIC's provincial reference was left uncapped in 2 provinces
  (Ilocos Sur 102.15, City of Butuan 101.00) while every barangay FIC was capped at 100 — so all
  **113** of their barangays would have read "worse than province" by construction. `comparesWorse`
  now returns null for a benchmark above the indicator's own maximum and the UI shows the figure
  with no verdict. The cleaning report's §6 caveat is now behaviour rather than a footnote.
- **The source's 88 provinces are 87.** Two of its name-groups are both Zamboanga City — 7
  barangays under a *blank* province name with no reference, and 1 under "CITY OF ZAMBOANGA" with a
  full set. `dim_geo` files all 8 under province `09317`. The `ref_uuc_phc_provincial` view is keyed
  on `dim_geo.province_code` for this reason (9 of the source's 88 names do not match `dim_geo` at
  all), and exposes `n_with_reference` so that 1-of-8 coverage is visible instead of a bare `max()`
  reporting one barangay's value as the whole province's benchmark.

*Verify — all green:*

| Check | Result |
|---|---|
| Indicator rows | **5,991**, one per listed barangay, none missing |
| Capped flags | **1,584** values across **1,397** barangays, matching the cleaning report per indicator |
| Bounds | `physical_factor` never below the AO's floor of 25; no coverage value > 100; no rate > 1,000 |
| Loaded values vs committed CSV | all 5,991 rows × 21 fields compared as decimals — **0 mismatches** |
| Provincial reference consistency | **0** provinces carry two different values (asserted in the migration, which aborts otherwise) |
| Provinces in the view | **87**; 1 with partial coverage (`09317`, 1 of 8), 1 with none (`02050`) |

A schema bug was caught in the process: `numeric(7,2)` silently rounded the 15 source values that
carry three decimals. The columns are unconstrained `numeric` — rounding is a display decision.

**U4 — PNG one-pager. Shipped 2026-08-26.**

`lib/exports/uuc-phc-figure.ts` + `app/api/export/uuc-phc`, mirroring
`profiling-status-figure.ts` — same canvas, same resvg path, same bundled-font constraint — but
rendering a membership list rather than a funnel: the count against its denominator, a single
two-state bar, and a child table ordered by share. A city/municipality sheet names its listed
barangays instead of a child table.

**No indicator values on the sheet.** A one-pager cannot carry the † marker's footnote, and
reproducing bounded values without it would be exactly the unmarked artefact U3 was built to
avoid. The sheet stays at the level the caveat is not needed.

**Nothing is dropped silently.** A province with more cities than fit (Cebu has 50, the cap is 42)
prints "+ 8 more with a lower share, 0 listed barangays between them" — naming both the count
omitted and what they contribute, so a reader can see the cap did not hide anything material.

*Verify:* rendered and visually inspected at every level — national, region, province, a
fully-listed city, a mixed one, a zero region, and Cebu's truncation line. 400 on bad parameters,
404 on an unknown geo. Line-packing unit-tested (`wrapNames`), since SVG does not wrap text and an
over-long line runs off the page with no error.

**Placement.** Own section `/uuc-phc` with the same national → region → province → citymun
drill-down, since this is a targeting dataset rather than a BHW measure. It is also a natural
overlay/filter on `/explore` — worth doing, but after U2, not inside it.

**Storage.** 5,991 fact rows and ~1,800 aggregate rows is well under 1 MB. This dataset is not a
scaling concern; the §5 opt-in aggregate discipline of the AI plan still applies to it, and the
596 MB-against-500 MB Free-plan position is unchanged by it either way.

---

## 7. Open questions

**Settled by the owner:**

- **Sulu's region** — confirmed. Place Sulu in Region IX per the source and the cue cards, recorded
  as `dim_psgc_crosswalk` rows, never as a `dim_geo` edit.
- **Codeless rows** — include rather than exclude, and find the codes. §4 resolves this: 32 of the
  33 were never barangays, and the loader skips them as layout. The one real row remains below.
- **Hosting clearance** for the cue cards corpus — cleared. `AI_ASSISTANT_PLAN.md` §12.5 updated.

- **Indicator bounds** — settled. Water, Pre-natal, SBA and FIC are coverage percentages capped at
  100; IMR, UFMR and ABR are rates per 1,000 capped at 1,000. Applied and reported in
  `UUC_PHC_2025_CLEANING_REPORT.md`. The negatives question is moot — the reconciled file had
  already removed them.
- **`SORSOGON / PILAR / SAN ANTONIO`** — resolved to `0506213048`. **All 5,991 barangays now carry
  a PSGC code**, so §4's last geography gap is closed and nothing is held back from U1.
- **FP CU** — confirmed dropped. The dataset carries 12 indicators, not 13.
- **Pass/Fail columns** — not to be used. All 15 are dropped from the cleaned dataset.
- **`#N/A` reference values** — left blank.
- **The published total** — **5,991**, with cue cards p37's 5,987 as a footnote citing DC No.
  2025-0549 (§3).

**No questions remain open** *for U1–U4* — both were unblocked and both shipped. Questions that
do not block a build but still need the source office are carried in §10; §7 is left as written,
as the record of what was settled before U1.

**One thing to carry into the build, not a question — now carried:** capped values are
indistinguishable from genuine ones once rendered. 886 Water and 456 FIC values now read as exactly
100%. U3 resolves this by naming the capped indicators per barangay (`capped_indicators`), marking
every affected value where it renders, and publishing no averages of these columns at all — the
warning that "any aggregate over those two indicators must exclude or footnote the capped rows" is
honoured by not building one. See `UUC_PHC_2025_CLEANING_REPORT.md` §6.

---

## 8. What the BHW Census section has that this one does not

U1–U4 built a dataset and a drill-down. The 2025 BHW Census section (`/bhw` + `/place/*` +
`/explore` + `/compare`) is a *reading surface* on top of a dataset, and the difference is most of
what a visitor experiences. This is the gap, verified file by file rather than from memory:

| Capability | BHW Census | `/uuc-phc` today |
|---|---|---|
| Landing page | `app/bhw/page.tsx` — hero + 4 stat tiles, each with a mini-viz and an enlarge chart | Hero + one two-state bar |
| Area profile | `app/place/[geoLevel]/[geoCode]/page.tsx` — 10 figure cards, benchmark rows, peer-rank chips, locator map, completeness | Hero + bar + child list + (at citymun) barangay list |
| Present mode | `PresentationProvider` / `PresentationSlide` / `PresentButton` on `/bhw`, `/place/*`, `/explore`, `/compare` | **landed (U6)** |
| Ask the data (chat) | `ChatLauncher` → `/api/ai/chat` on `/bhw`, `/explore` | **landed (U8)** |
| AI insight slot | `AiInsight` → `getOrGenerateNarrative` on `/bhw`, `/place/*` | **landed (U8)** |
| Curated insight cards | `InsightsGrid` ← `lib/db/insights.ts` (718 lines of generators) | **none** |
| Spot feedback | `SpotFeedback`, mounted globally in `app/layout.tsx` | **already renders** — it is gated off `/admin` and `/` only |
| Map / filters | `/explore` — choropleth, geo cascade, breakdown picker, 15 figures | **none** |
| Side-by-side | `/compare` | **none** |
| Data downloads | CSV / XLSX / PNG / PPTX per figure via `ExportMenu` | One whole-area PNG one-pager |
| Glossary hooks | `GlossaryTerm` throughout | **none** |
| Social card | `opengraph-image.tsx` on `/bhw` and `/place/*` | **landed (U6)** |

`/profiling-status` has the same gaps. Where an increment below changes shared machinery, it is
noted — the fix should land in a form that section can adopt too, not a `/uuc-phc` fork of it.

### Four things the shared machinery cannot do yet

These are not opinions about design; they are defects that would produce wrong output if the
components were simply dropped onto `/uuc-phc`. Each is small, and each has to be fixed by the
increment that first needs it.

1. ~~**`PresentationSlide` hard-codes the brand.**~~ **Fixed in U6.** Its promoted-slide header
   printed the literal `BHW Connect` (`components/present/presentation-slide.tsx`), as did
   `PresentationDeck`'s closing slide. `DeckMeta.brandLabel` now carries it, optional and
   defaulting to `"BHW Connect"`; resolution is `brandLabelOf` in `deck-logic.ts`.
   `/profiling-status` can adopt it with a one-line change.
2. ~~**The AI narrative cache key has no dataset dimension.**~~ **Fixed in U8.** It keyed on
   `data_version|geo|narrative_type` with `data_version` from `getActiveDataset()` — the *BHW*
   dataset's — so a UUC insight for Region VII collided with the BHW insight for Region VII.
   `narrative_type` was already a free extension point, so the fix was one enum value
   (`'uuc_overview'`) and no migration, as predicted. `data_version` is now the scope's own
   dataset's, which is what makes a *UUC republication* invalidate UUC insights.
3. ~~**The ask-cache key has the same hole.**~~ **Fixed in U8, and it was larger than this.**
   `askCacheKey` gained the dataset slug — but the A4 near-match path never reads the cache key at
   all, matching on the `data_version` and `geo_code` *columns*, so `ai_ask_cache.dataset_slug` and
   a `dataset` argument to `match_ask_answer` were needed too. And `refreshApprovedAskAnswers` had
   the same hole a third time: it would have found every UUC row stale against the BHW version and
   regenerated it under the BHW prompt and tools, writing a wrong-dataset answer back at
   `status = 'approved'` — the one status the near-match path is allowed to reuse.
4. ~~**The chat's tools are BHW-shaped.**~~ **Routed around by U5, used in U8.** `lib/ai/tools.ts` exposes seven hand-written tools
   (`getIndicatorByGeo`, `getTrainingCoverage`, …), none of which can see this dataset. The
   generic path already exists — `runToolLoop` takes a `tools` argument
   (`lib/ai/agent-loop.ts:29`) and `lib/ai/query-dataset.ts` queries any *registered* table under
   a per-column allowlist. That path reaches this dataset only once the registry knows about it,
   which is U5. U8 uses it, narrowed further to this dataset's own relations: exposure alone would
   have handed the section all 26 public relations and let the two sections answer each other's
   questions by construction.

---

## 9. Increments U5 – U12

Same discipline as U1–U4: each is independently shippable, each states its Verify, and none is
started before its dependency lands. Dependencies: **U5 → U8**; **U7 → U9's factor view**;
everything else is parallel.

### U5 — Registry, lineage, and the SECURITY DEFINER view — **LANDED 2026-08-26**

All four relations are registered with full column dictionaries, every table node in `kb_node`
carries a `built-by` edge (the generator's stderr finding is clear for the first time), and
`ref_uuc_phc_provincial` runs `security_invoker = true` with the advisor clean. See
`docs/DECISIONS.md` and `docs/uuc-phc-feature.md`. The scope below is kept as written.

**Carried debt, not new work.** PRs #75 (this dataset) and #76 (the internal AI assistant) were
written against each other's absence and both merged. Three statements committed to `main` are now
false or incomplete:

| Where | What it says | What is true after #75 |
|---|---|---|
| `20260826090100_seed_dataset_registry.sql:172` | `fact_uuc_phc_barangay` "has no committed migration in supabase/migrations" | `20260826121000_fact_uuc_phc_barangay.sql` is committed |
| `DECISIONS.md` (1.2) | `agg_uuc_phc_counts` deliberately unregistered, "a few added rows once that branch lands" | it landed |
| `DECISIONS.md` (1.5) | `table:fact_uuc_phc_barangay` is the one node with no `built-by` edge, printed to stderr | the migration that builds it now exists to point at |

Scope:

- Correct the `notes_md` on `fact_uuc_phc_barangay` and add registry entries + column dictionaries
  for `agg_uuc_phc_counts`, `fact_uuc_phc_indicators` and `ref_uuc_phc_provincial`. The seed is
  idempotent, so this is added rows, not a rewrite.
- Add the missing `built-by` edges to `kb_lineage` for all four objects, and `derived-from` edges
  from the indicators table to the cleaning report.
- **Fix the ERROR-level advisor finding.** `ref_uuc_phc_provincial`
  (`20260826150000_fact_uuc_phc_indicators.sql:111`) is created without
  `with (security_invoker = true)`, so it runs as its owner and bypasses the RLS of the table
  beneath it. `DECISIONS.md` (1.6) records it as "not this increment's to change" — it is this
  one's. It is the repository's only view, so there is no local convention to follow; set
  `security_invoker` and let the fact table's public-read policy be the thing that grants access.

*Note on the dictionaries.* `queryDataset` refuses a table with no approved dictionary outright, so
the column descriptions are not documentation here — they are the allowlist. `capped_indicators`
in particular must carry the caveat in its `notes_md`, because a model reading a `100` with no
adjacent explanation will report full coverage, which is exactly the failure U3 was built to stop.

*Verify:* registry returns 4 UUC tables with dictionaries; `queryDataset` can select
`agg_uuc_phc_counts` and is refused on an unregistered column; the lineage generator prints **no**
table without a `built-by` edge; `get_advisors` returns no `security_definer_view` for
`ref_uuc_phc_provincial`; a public read of the view still works as `anon`.

### U6 — Present mode, section chrome, and dataset-aware feedback — **LANDED 2026-08-26**

Both routes present, with `DeckMeta.brandLabel` defaulting to `"BHW Connect"` so the four existing
decks are unchanged; `feedback.dataset_slug` is derived server-side from the page path; the
correction entry point is in the section footer; both routes have social cards. See
`docs/DECISIONS.md` and `docs/uuc-phc-feature.md`. The scope below is kept as written.

Bring the two existing pages up to the chrome the BHW pages carry.

- **Present mode** on `/uuc-phc` and `/uuc-phc/[geoLevel]/[geoCode]`. Wrap each page in
  `PresentationProvider`, mark the hero, the share bar, the child breakdown and (at citymun) the
  barangay list as `PresentationSlide`s, and add `PresentButton` to the section header.
  `DeckMeta.captionLine` reads `N = 5,991 listed barangays · <area> · 2025 list (DC No.
  2025-0549)`, matching the Person/Place/Time discipline the rest of the site uses.
- **De-brand the slide chrome** (§8 defect 1): add `brandLabel` to `DeckMeta`, default it to
  `"BHW Connect"` so every existing caller is unchanged, and pass `"UUC for PHC"` here. This is
  the shared-machinery change `/profiling-status` should also pick up.
- **Feedback.** `SpotFeedback` already renders on these pages; nothing is missing at the widget
  level. What is missing is that `feedback` carries only `page_path`
  (`20260719101400_feedback.sql`), so a correction about this list arrives indistinguishable from
  a UI bug on `/explore` except by string-matching a URL. Add a nullable `dataset_slug` and set it
  from the section, and add one section-specific entry point in the UUC footer: **"Is a barangay
  missing from this list, or listed in error?"** That is the correction this dataset actually
  attracts — it has a known ambiguous row (§4's San Antonio, Pilar) and a published figure four
  higher than the deck's (§3) — and routing it to the source office is a different action from
  triaging a bug.
- **`opengraph-image.tsx`** for both routes, mirroring `app/bhw/opengraph-image.tsx`. The share
  count is the headline; this list gets circulated in exactly the settings where a link preview
  matters.

*Verify:* deck starts, advances and exits on both routes, and the slide header reads "UUC for PHC";
every existing `/bhw`, `/place/*`, `/explore` and `/compare` deck still reads "BHW Connect";
feedback submitted from `/uuc-phc` lands with `dataset_slug = 'uuc-phc-2025'` and is visible in the
admin inbox; OG images render at 1200×630 at national, a region and a citymun.

### U7 — `/uuc-phc/criteria`: why these barangays qualified — **LANDED 2026-08-27**

`agg_uuc_phc_criteria` is built and registered, and `/uuc-phc/criteria` renders the four routes as
four independent shares at national, region, province and city/municipality. Two things the scope
below did not anticipate, both recorded in `docs/DECISIONS.md`:

- **`health_indicators` had to be loaded first.** The Verify below names a column that was never in
  `fact_uuc_phc_indicators` — U3 left it out on §10's advice. Recomputing it from the published
  (capped) columns disagrees with the source on 664 rows and leaves **98 listed barangays
  qualifying on no route at all**, which §1a makes impossible. So the column is loaded as the
  source's own recorded classification, which is also what keeps this a count of classifications.
- **The not-evaluable figure is 226, not 238.** §1a's and the cleaning report's own per-province
  tables sum to 226; 238 was an addition error carried through both. Corrected above, and the page
  computes it.

The scope below is kept as written.


**The single largest analytical gap.** §1a establishes that a barangay qualifies on a physical
factor *and* one of four socio-economic routes — and today that "why" is visible only inside a
`<details>` on one city page at a time. There is no way to ask "how many of BARMM's 399 qualified
on the 4Ps route?" without reading 399 disclosures.

New aggregate `agg_uuc_phc_criteria`, keyed `(dataset_id, geo_code, geo_level)` at
national/region/province/citymun, with one count per qualifying route: IP ≥ 10%, armed
conflict/IDP ≥ 10% or ELCAC-designated, 4Ps ≥ 50%, and health indicators ≥ 4 of 7.

**This aggregate is safe where the indicator ones were not, and the reason is worth stating.** U3
declined per-indicator aggregates because a mean absorbs the capped ceilings and reports coverage
the source does not support. A route count is a count of *classifications*, not of measurements:
it never averages a bounded value, so the † problem does not arise. The one route that touches the
capped columns is the health-indicator route, and it inherits §1a's caveat rather than a new one —
which is why the page names the 226 barangays where criterion (d) is not evaluable at all
(U10 renders the same set).

Two things the page must say plainly:

- **The routes overlap and the counts do not sum to the total.** A barangay can qualify on three
  routes at once. Render as four independent shares of the area's listed count, never as a
  stacked bar or a pie, both of which assert a partition that does not exist.
- **Computed in SQL from `fact_uuc_phc_indicators` + `dim_geo`**, on U2's precedent: re-running
  the migration recomputes every row, so the aggregate cannot drift and re-running is the refresh
  procedure.

*Verify:* every area's per-route counts are ≤ its `n_listed` and ≥ 0; the national count for each
route matches a direct count over the fact table; the health-indicator route count equals the
number of rows with `health_indicators >= 4`; at least one area is shown where routes overlap and
the four shares sum above 100%, confirming the rendering does not imply a partition; the 226
not-evaluable barangays are excluded from the health route's denominator and the exclusion is
stated on the page.

### U8 — Ask the data: chat and an AI insight slot — **LANDED 2026-08-27**

Both surfaces are live on the section, and §8's defects 2 and 3 are fixed. Three things the scope
below did not anticipate, all recorded in `docs/DECISIONS.md`:

- **The ask-cache key was not the whole of defect 3.** `match_ask_answer` (the A4 near-match path)
  never reads the cache key — it matches on the `data_version` and `geo_code` *columns* — so
  `ai_ask_cache.dataset_slug` and a `dataset` argument to the function were needed too. And there
  is a **third** place the plan does not name: `refreshApprovedAskAnswers` would have found every
  UUC row stale against the *BHW* version and regenerated it under the BHW prompt with the BHW
  tools, writing a wrong-dataset answer back at `status = 'approved'`.
- **The tool set is narrowed to this dataset, not left at `public` exposure.**
  `createDatasetTools('public')` hands over all 26 public relations. Nothing unsafe — `anon` reads
  them all — but it would make the two sections answer each other's questions by construction.
  Relations with no `dataset_slug` (`dim_geo`, `dim_dataset`) stay in scope: `dim_geo` is what lets
  an answer tell "not on the 2025 list" apart from "there is no such barangay".
- **Two wrong figures in the column dictionaries**, which is the text a model reads before
  composing a query: `ref_uuc_phc_provincial` still carried **238** (U7 established 226), and
  `agg_uuc_phc_criteria` said the four routes come to "about **141** percent" where the live row
  gives **146** — the figure `/uuc-phc/criteria` prints. Both corrected and guarded by tests; every
  other figure in the five UUC dictionaries was checked against live data and is correct.

**Phase 2's document corpus is deliberately not reachable from this chat.** PR #81 landed
`searchDocuments`, and the corpus is the 2027 Budget Cue Cards — internal budget material, with
`AI_ASSISTANT_PLAN.md` §12.5 explicit that clearance to load is not clearance to expose. Slides 37
and 141 carry this list's own regional distribution, which is exactly what makes it tempting and
exactly what `agg_uuc_phc_counts` already answers.

The scope below is kept as written.

**Depends on U5.** Both surfaces the BHW section has, scoped so they cannot answer from the wrong
dataset.

- **`ChatLauncher` on `/uuc-phc` and the area pages**, running `runToolLoop` with the registry
  tools from `lib/ai/dataset-tools.ts` instead of `lib/ai/tools.ts`. No new tool code: the model
  reaches this dataset through `queryDataset` over the four tables U5 registers. The existing
  rate limit, provider cascade and `auditNarrative` pass are unchanged — `auditNarrative` is
  already dataset-agnostic, since it checks numbers against the tool payloads it was given.
- **Fix both cache keys first** (§8 defects 2 and 3). Add the dataset to `askCacheKey` and add a
  `'uuc_overview'` `NarrativeType`. Without this the two sections silently serve each other's
  answers, and the failure is invisible — a cross-dataset hit is fluent, grounded and wrong.
- **Starter questions** replaced for this section: `ChatLauncher`'s three hard-coded prompts are
  BHW questions ("What's the biggest training gap nationally?"). Make them a prop.
- **`AiInsight`** on the area pages, once `narrative_type` separates the caches.

*Refusals matter more here than on `/bhw`.* This dataset is a targeting list, so the questions it
invites ("should my barangay be on this list?", "why was this one included?") are ones the data
cannot answer — presence is recorded, the assessment behind it is not. The system prompt must say
so, and the answer must point at the source office rather than reasoning from the indicators.

*Verify:* the same question asked on `/bhw` and `/uuc-phc` returns two different grounded answers
and two distinct cache rows; a question about a barangay not on the list gets "not on the 2025
list", never an inferred one; a question about *why* a barangay qualified is answered from
`fact_uuc_phc_indicators` where the data supports it and refused where it does not; a capped value
is never reported without its caveat; rate limiting and the audit behave as on `/bhw`.

*What was verified, and the one thing that was not.* Everything below the provider boundary: two
distinct cache keys and two distinct near-match scopes, proved live at the database; the tool set,
the refusals and the payload caveats, exercised end to end against live data with a **scripted
model** in place of the provider; the surfaces, the copy and the deck, driven in Chromium. A live
model answering a real question is **not** verified — this environment has no provider key, so the
chat degrades to "Live AI is at capacity right now" (the correct `allCapped` path, and what was
seen). That is the same gap Increments 1.3, 1.4, 2.2 and 2.3 record, and it closes with a key on
the deployed preview.

### U9 — `/uuc-phc/indicators`: the indicators above barangay grain, without averaging

U3 established a rule — *mark the value, never average it* — and honoured it by publishing no
aggregates, which leaves the 12 indicators visible only one barangay at a time. That is stricter
than the rule requires. **A distribution is not a mean:** a histogram renders every value at its
own position, so a capped value stays where the cap put it instead of being absorbed into a
figure that hides it.

One page, one section per indicator, scoped to any geo level:

- A histogram of the area's listed barangays, with **the top bin drawn and labelled distinctly**
  where it contains capped values ("886 of these are values the source recorded above 100%,
  bounded at 100 — their true figures are unknown"). The pile-up becomes the visible artefact it
  is, which is the opposite of what a mean does to it.
- The provincial benchmark from `ref_uuc_phc_provincial` drawn as a reference line, absent where
  the province has none, and **omitted entirely where the benchmark exceeds the indicator's own
  maximum** — the same `comparesWorse` rule U3 applied per barangay, applied to the axis.
- A count, never a percentage, of barangays worse than their province — with the 226
  not-evaluable barangays named and excluded.

**No mean, median or national "average water coverage" anywhere on this page**, and the page says
why in one line. The temptation this page creates is exactly the one U3 refused; building it
without stating the refusal would re-open the hole.

*Verify:* every histogram's bin counts sum to the area's listed count; the capped bin's label
count matches `capped_indicators` for that indicator and area, per the cleaning report; no
benchmark line renders for Ilocos Sur or City of Butuan on FIC; no summary statistic appears in
the DOM; the page renders at national, a region, a province and a citymun, and at a zero area
(NCR) shows an empty state rather than an empty chart.

### U10 — `/uuc-phc/data-quality`: the cleaning report as a surface

`UUC_PHC_2025_CLEANING_REPORT.md` §6 is the most important thing written about this dataset and
it is invisible to anyone using it. `/data-quality` already exists as the pattern for the BHW
dataset. Render, from the data rather than transcribed:

- **What was bounded**: 1,584 values across 1,397 barangays, per indicator, with the share of the
  list each represents (Water 886 = 14.8%).
- **Where the comparison cannot be made**: the 5 provinces / 226 barangays whose references are
  placeholders, zeroes, `#N/A` or fractions, and the 113 barangays in 2 provinces with an
  impossible FIC benchmark.
- **The published-total reconciliation**: 5,991 vs the cue cards' 5,987, the two affected regions,
  and the vintage reading — with §3's caveat that it is inference from the file name and internal
  agreement, *not* something either source states.
- **What is known to be unresolved**: the underlying encoding error that capping only contains,
  and `Health Indicators` being retained but not recomputable from the published columns.

**This page is a claim about our own data, so every figure on it must be computed, not typed.** A
hand-written "1,584" drifts the first time the extract is regenerated, and a stale data-quality
page is worse than none.

*Verify:* every figure on the page recomputes from `fact_uuc_phc_indicators` and matches the
cleaning report; regenerating the extract with an altered cap changes the page; the province and
barangay lists are rendered from the data, not from a constant; links from `/uuc-phc/indicators`
and the methodology page resolve here.

### U11 — Downloads: the list as CSV and XLSX

The one-pager is a picture. Anyone doing work with this list needs the rows.

`parseExportQuery` (`lib/exports/query.ts`) is keyed to the BHW `indicatorSchema`, so this does
**not** extend `/api/export/csv`; it is `/api/export/uuc-phc/data` with its own contract
(`geoLevel`, `geoCode`, `format`). Scoped to any area, it emits one row per listed barangay:
PSGC, the four source name fields, the qualifying routes, the 12 indicators, the 7 benchmarks, and
**`capped_indicators` as an explicit column**.

That last column is the point. U4 refused to put indicator values on the PNG because a one-pager
has nowhere to carry the † footnote. A spreadsheet does — a column, plus a header comment block
carrying the source, the DC number, the retrieval date and the capping caveat, exactly as
`/api/export/csv` already does. This is not a relaxation of U4's rule; it is the same rule
reaching a format that can satisfy it.

*Verify:* the national CSV has 5,991 data rows and round-trips against the committed extract with
zero mismatches; a citymun export matches that page's barangay list exactly; the capped column is
non-empty for exactly 1,397 barangays; the header block carries the source, licence, DC number and
caveat; XLSX opens in Excel and Sheets with the caveat visible without scrolling; a zero area
returns a valid empty file with its header, not a 404.

### U12 — The `/explore` overlay, and the question that needs both datasets

The idea U4 left unbuilt, in two halves that ship separately.

**U12a — Context, everywhere a place appears.** A chip on `/explore` and `/place/*`: *"31 of this
area's 118 barangays are on the 2025 UUC for PHC list →"*, reading `agg_uuc_phc_counts` with no
new aggregate. Cheap, and it is how anyone looking at BHW figures discovers this dataset exists.

**Deliberately not a new option in the map's indicator switcher.** `MAP_BASE_INDICATOR_META`'s
entries are all shares of *BHW profiles*; "% of barangays listed" is a share of *barangays*.
Dropping it into the same `<select>` puts two different universes behind one legend and one
colour ramp, and nothing on the map would tell a reader they had changed denominators. If the
choropleth is to carry it, it is a **second, separately-legended layer** with its own caption —
that is a design decision to take with the map, not a line in a `Record`.

**U12b — `agg_bhw_by_uuc_status`: are BHWs thinner on the ground where communities are unserved?**
This is the reason both datasets sit in one dashboard, and it is answerable: `agg_bhw_counts` is
built at **all five levels including barangay** (`ingestion/build_aggregates.sql` §2), and
`fact_uuc_phc_barangay` is barangay-grain, so the join key exists. Per geo and level, BHW
indicators split listed vs. not-listed.

Three things to settle before building it, all of which change what the figure means:

1. **What "not listed" is.** U1 loaded only the 5,991; the workbook's 9,395 assessed-but-not-listed
   rows were scoped out. So the comparison group is *every other barangay in the area*, not
   *assessed and not listed*. That is the right denominator on this section's existing reasoning
   — but the label has to say "all other barangays", because a reader will otherwise hear
   "assessed and found adequate".
2. **Disclosure.** Individual barangay cells in `agg_bhw_counts` can carry small n. Aggregating
   *across* thousands of barangays is safer than the per-barangay view already published, but the
   split must not become a way to read a single barangay's figures — suppress any cell whose
   contributing barangay count is below the §4.1 threshold.
3. **Causal reading.** UUC status is defined partly by *health-system access*, so a gap in BHW
   coverage between the two groups is in part definitional, not a finding. The figure's caption
   has to say this. Publishing "unserved barangays have fewer BHWs per household" as a discovery,
   when the list was drawn partly on distance to a health facility, would be circular.

*Verify:* the chip's counts match the UUC section for the same geo; listed + not-listed barangay
counts sum to `dim_geo`'s total for every area; the split reproduces the unsplit `agg_bhw_counts`
figure when recombined; suppressed cells render as suppressed, not as zero; the caption carries
the definitional caveat; national, a region, a province and NCR (nothing listed) all render.

### Considered and not planned

- **`/uuc-phc/compare`.** `/compare` earns its place because a BHW profile has ten dimensions to
  line up. A membership list has two numbers and a share; a side-by-side of four areas is a table
  the child breakdown already renders, ranked. Revisit after U7 — comparing *qualifying routes*
  across areas is a real question, and it belongs on the criteria page rather than a new route.
- **A barangay page.** Unchanged from U2: it would be one yes/no plus a `<details>` that already
  renders on the citymun page. `/uuc-phc/barangay/*` continues to 404.
- **Per-indicator map choropleths.** The values are capped in 15% of barangays for Water; a colour
  ramp cannot carry a † and a map is the format most likely to be screenshotted away from its
  caveat. U9's histograms are the honest version of this.

---

## 10. Carried questions, unchanged by this revision

§7 closed the questions that blocked U1–U4. These remain open, none of them blocking, all of them
for the source office (BLHSD) rather than for the build:

- **FP CU's removal leaves 7 of the AO's 8 indicators with the `≥ 4` threshold apparently
  unchanged** — a stricter test than the order specifies. Does not affect this already-selected
  list; settle before the next profiling round (§1a).
- **FIC's provincial benchmark is uncapped while barangay FIC is capped**, so 113 barangays in 2
  provinces read as worse-than-province by construction. U3 made this render as "no verdict";
  capping the reference to 100 would close it properly, and was outside the instruction given.
- **Criterion (b) is implemented as a sum, not the order's "or"** — matches all 5,991 rows, but
  disagrees with an either-alone reading on 15 (§1a).
- **Five provinces / 226 barangays cannot support criterion (d) at all.** U7 and U9 exclude them
  and say so; the references themselves still need fixing at source.
- **The 5,991 vs 5,987 vintage reading is inference, not a statement either source makes** (§3).
  U10 renders it as such. Worth confirming.
- **`Health Indicators` (0–7) is retained but not recomputable** from the published columns —
  drop or recompute before anything depends on it.
- **The encoding error behind the capping is unresolved.** If a corrected extract arrives,
  regenerate rather than patch.

---

*Follows the conventions in `BUILD_PLAN.md` §5 and the per-increment logging of `DECISIONS.md`.
If any statement here conflicts with `BUILD_PLAN.md`, that document governs.*
