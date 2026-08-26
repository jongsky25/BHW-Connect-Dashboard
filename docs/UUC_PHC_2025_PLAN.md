# UUC for PHC 2025 — Unserved and Underserved Communities (handoff document)

A dedicated dashboard card and section for the **2025 list of Unserved and Underserved
Communities for Primary Health Care**, built from `ingestion/data/Submissions_UUA_2025_filled_1.xlsx`.

**Status:** proposed. Increment U1 is unblocked; U3 is blocked on a units question for the
source office (§5).

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

Policy basis: **DC No. 2025-0549** (cited on cue cards p37).

Proposed slug **`uuc-phc-2025`**, `geo_join_level = 'barangay'`, `as_of_date = 2025-01-01`.
Keep `UUA` only as the raw column value inside the fact table, never in UI copy.

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

Two localized discrepancies, no systemic drift. **Resolve before publishing a headline number** —
a card that says 5,991 next to a briefing deck that says 5,987 will be read as a dashboard bug.
Recommend treating p37 as authoritative for the published total (it cites the department circular)
and referring the 6 affected barangays back to the source office, then recording the outcome in
`DECISIONS.md`. This follows the pattern already set by `POPULATION_RECONCILIATION.md` and
`BOUNDARY_RECONCILIATION.md`.

---

## 4. Geography — joins cleanly, with one known exception

The good news: `dim_geo` holds **41,958 barangays keyed on 10-digit codes**, and `2025 LIST.PSGC`
is already 10-digit. No crosswalk work is needed for the bulk of the file.

*Verified:* a random sample of 150 of the 5,991 codes joined **148/150** against
`dim_geo` at `geo_level='barangay'`. Both misses were Sulu.

**The Sulu exception.** 87 codes carry the prefix `09066` — Sulu under **Region IX**, following
its 2024 removal from BARMM. `dim_geo` still holds Sulu as **`19066`** under region 19 (410
barangays, `psgc_vintage = '2023 series (>=2024 release, includes NIR)'`). The workbook and the
cue cards agree with each other here — p37's Region IX count of 523 includes Sulu — so the
dashboard's geography is the side on the older vintage.

The remap is mechanical: region digits `19` → `09`, province and barangay digits unchanged
(`19066NNBBB` → `09066NNBBB`). **Do it as `dim_psgc_crosswalk` rows, not as a hand-edit of
`dim_geo`.** That table exists for exactly this, and `AI_ASSISTANT_PLAN.md` §3 names it the model
every later entity-resolution problem should follow. A silent `dim_geo` edit would also
retroactively move every existing BHW figure for Sulu between regions.

Also: **~33 rows in `2025 LIST` have a barangay name but no PSGC.** They need codes from the
source office or explicit exclusion, the same way the profiling-status loader takes `--exclude`
for the four all-zero City-of-Manila districts.

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

The eight are units-ambiguous — some values read as counts, some as percentages, some as rates
per 1,000 — and negatives are impossible under every one of those readings. Publishing them
unresolved would put unexplainable figures on a public page.

**This does not block the card.** The classification (*which* barangays are UUC for PHC) is
clean, is the part the cue cards actually publish, and is the part with a policy citation. Ship
that first; hold the indicators for U3 pending a per-column units confirmation from the source
office.

---

## 6. Proposed increments

Mirrors `bhw-profiling-status-2026`. Each is independently shippable and must pass its Verify.

**U1 — Classification, national.**
`dim_dataset` row (`uuc-phc-2025`); `fact_uuc_phc_barangay` (`geo_code`, `decision`,
`source_region/province/citymun/barangay` as given); `dim_psgc_crosswalk` rows for the 87 Sulu
codes; a `--exclude` path for the ~33 codeless rows. Loader `ingestion/ingest_uuc_phc.py`,
generating a seed migration, following `ingest_encoding_status.py`.
*Verify:* 5,991 UUA + 9,395 NOT UUA loaded; **every** `geo_code` resolves in `dim_geo` after the
crosswalk (this is where the 150-row sample of §4 becomes an exhaustive check); regional counts
reproduce the §3 table exactly, including the two known deltas.

**U2 — Aggregates and the card.**
`agg_uuc_phc_counts` keyed `(dataset_id, geo_code, geo_level)` with barangay → citymun →
province → region → national rollups, mirroring `agg_bhw_stepzero_counts`. Card renders count
of UUC-for-PHC barangays, share of all barangays in the area, and child-area drill-down.
*Verify:* national == Σ regions == 5,991; province == Σ its citymuns; spot-checks against p37.

**U3 — Indicators.** Blocked on §5. Adds the 13 columns to the fact table plus per-indicator
aggregates only for those a page renders.

**U4 — PNG one-pager.** Optional; reuses `@resvg/resvg-js` and
`lib/exports/profiling-status-figure.ts`.

**Placement.** Own section `/uuc-phc` with the same national → region → province → citymun
drill-down, since this is a targeting dataset rather than a BHW measure. It is also a natural
overlay/filter on `/explore` — worth doing, but after U2, not inside it.

**Storage.** 5,991 fact rows and ~1,800 aggregate rows is well under 1 MB. This dataset is not a
scaling concern; the §5 opt-in aggregate discipline of the AI plan still applies to it, and the
596 MB-against-500 MB Free-plan position is unchanged by it either way.

---

## 7. Open questions for the owner

1. **The 4-barangay delta** (§3) — is p37 or the workbook authoritative for the published total?
2. **Units for the eight indicator columns** (§5), per column, from the source office.
3. **The ~33 rows without a PSGC** (§4) — codes, or exclude?
4. **Sulu's region** — confirm the dashboard should follow the source and the cue cards in placing
   Sulu in Region IX, and that the crosswalk (not `dim_geo`) is where that is recorded.

---

*Follows the conventions in `BUILD_PLAN.md` §5 and the per-increment logging of `DECISIONS.md`.
If any statement here conflicts with `BUILD_PLAN.md`, that document governs.*
