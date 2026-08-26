# UUC for PHC 2025 — Unserved and Underserved Communities (handoff document)

A dedicated dashboard card and section for the **2025 list of Unserved and Underserved
Communities for Primary Health Care**, built from `ingestion/data/Submissions_UUA_2025_filled_1.xlsx`.

**Status:** **complete — U1 through U4 shipped** (2026-08-26). The 5,991 rows are loaded, rolled up
to every geo level, rendered at `/uuc-phc` from national down to city/municipality with each listed
barangay showing the factors it qualified on and its health indicators (capped values marked), and
every area has a downloadable PNG one-pager. Feature write-up: `docs/uuc-phc-feature.md`.

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

**Five provinces have references that cannot support the comparison at all** — 238 barangays, 4%
of the list:

| Province | Barangays | Problem |
|---|---:|---|
| Agusan del Sur | 156 | Every reference is exactly `1` — a placeholder, not a measurement |
| Nueva Vizcaya | 50 | No reference at all (`#N/A`) |
| Cagayan | 12 | Every reference is `0` |
| Zamboanga City (HUC) | 7 | No reference at all (`#N/A`) |
| Special Geographic Area (BARMM) | 1 | All values below 1 — recorded as fractions, not percentages |

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
| `20260826120000_fact_uuc_phc_barangay.sql` | Table: `geo_code`, `source_geo_code`, `source_region/province/citymun/barangay`; RLS public-read |
| `20260826120100_seed_dim_dataset_uuc_phc.sql` | `dim_dataset` row, slug `uuc-phc-2025`, `geo_join_level = 'barangay'` |
| `20260826120200_crosswalk_sulu_region_ix.sql` | Sulu vintage map, derived FROM `dim_geo` — all 430 Sulu geos, not just the 87 needed |
| `20260826120300_seed_fact_uuc_phc_barangay.sql` | 5,991 rows, generated |
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

**No questions remain open.** U1 and U3 are both unblocked.

**One thing to carry into the build, not a question — now carried:** capped values are
indistinguishable from genuine ones once rendered. 886 Water and 456 FIC values now read as exactly
100%. U3 resolves this by naming the capped indicators per barangay (`capped_indicators`), marking
every affected value where it renders, and publishing no averages of these columns at all — the
warning that "any aggregate over those two indicators must exclude or footnote the capped rows" is
honoured by not building one. See `UUC_PHC_2025_CLEANING_REPORT.md` §6.

---

*Follows the conventions in `BUILD_PLAN.md` §5 and the per-increment logging of `DECISIONS.md`.
If any statement here conflicts with `BUILD_PLAN.md`, that document governs.*
