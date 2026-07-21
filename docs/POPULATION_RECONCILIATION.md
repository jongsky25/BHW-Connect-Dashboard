# Population reconciliation — PSA POPCEN 2024 & CPH 2020 → dim_geo (E4.2)

The 1.6-style reconciliation record for the census population load (`agg_population`). The two
PSA "Table B" workbooks carry geography **names**, not PSGC codes, so every row is name-matched
to `dim_geo` (the post-NIR join target of truth) and national/region/province figures are rolled
up from the matched city/municipality leaves via `dim_geo`'s own parentage. Matching logic and
the run itself live in `ingestion/ingest_population.py`; the machine-readable residual list is
`ingestion/_qa_report_population.json` (regenerate with `--verify`). Nothing is silently dropped.

## Headline match rate

| Source | census_year | citymun matched | national roll-up | PSA published | delta |
|--------|-------------|-----------------|------------------|---------------|-------|
| POPCEN 2024 | 2024 | **1,628 / 1,639 (99.3%)** | 111,641,591 | 112,729,484 | −0.97% |
| CPH 2020 | 2020 | 1,618 / 1,639 (98.7%) | 107,000,833 | 109,035,343 | −1.87% |

All **3,517 rows** (1,764 POPCEN + 1,753 CPH) are loaded live and verified — per-dataset row counts,
grain, and national roll-ups match this table to the peso.

The national shortfall is **not** a matching error — it is the population of LGUs that do not
exist in `dim_geo` at all (see below), plus Manila being stored at its province node. Per-capita
figures are only ever computed for BHW-covered geos, so those absent LGUs would never appear.

## How three PSA-vintage frictions were handled

- **NIR (2024).** CPH 2020 is pre-NIR (Negros under Regions VI/VII); `dim_geo` is post-NIR
  (Region XVIII). Because region/province totals are rolled up from citymun leaves keyed on
  `dim_geo`'s post-NIR parentage — not from the file's printed subtotals — the CPH numbers land on
  Region XVIII automatically. No hand-seeding.
- **Manila.** One census row ("CITY OF MANILA") vs 16 district city/municipalities in `dim_geo`.
  The census total is stored at the Manila **province node** (`geo_code` 13806); the 16 districts
  carry no census population and fall back to their parent (the same pattern as `agg_training`'s
  barangay gap).
- **Province = town name collisions.** ~200 towns share a name with a province (QUEZON, RIZAL,
  BULACAN, LEYTE, SIQUIJOR, …). A province header is distinguished from an eponymous town by two
  rules: the following data leaf must be one of *that province's* towns, and a name equal to the
  province already in context is the town, not a re-header.

## Residuals (documented, not dropped)

### LGUs absent from `dim_geo` (no BHW records → no FK target)
`dim_geo` was built from the BHW dataset, so municipalities with zero BHW records are simply not
in it and cannot receive a census row. Both years: **Imus, Gen. Mariano Alvarez** (Cavite);
**Mulanay, Padre Burgos, Pitogo, San Andres, San Francisco** (Quezon); **Sumisip, Tipo-Tipo,
Al-Barka** (Basilan); **Kapatagan** (BARMM/Lanao del Sur). Cavite has 21 citymuns in `dim_geo` vs
23 in PSA; Quezon 34 vs 41; Basilan 9 vs 13 — a coverage gap in the BHW universe, surfaced here.

### CPH-2020-only residuals
- **Bacolod City** — the E4.1-flagged crosswalk gap (its pre-NIR code isn't a clean region-prefix
  swap); covered by POPCEN 2024, absent from the CPH load.
- **Cotabato City** and the pre-split **"MAGUINDANAO (excluding Cotabato City)"** subtotal — the
  2022 Maguindanao del Norte/del Sur split post-dates CPH 2020; the subtotal is not a leaf, and
  **Parang** is genuinely ambiguous (a Parang exists in both Maguindanao and Sulu), so it is left
  unmatched rather than guessed.
- **Special Geographic Area (SGA) barangay-clusters** in BARMM — present in `dim_geo`, not
  itemised comparably in CPH 2020.

## Spelling reconciliations applied (documented, not guesses)
`BALIUAG→BALIWAG`, `PIO V. CORPUS→CORPUZ`, `LEON T. POSTIGO→BACUNGAN` (rename), `DR. JOSE P.
RIZAL→RIZAL` (Palawan). See `SPELLING_FIXUPS` in `ingestion/ingest_population.py`.

## Not yet loaded: 2020 CPH household counts
Only population is loaded. The 2020 CPH *household* table (Number of Households / Average
Household Size) is a separate PSA file and a documented follow-up; it would populate a
`households_2020` measure and give a census denominator for households-per-BHW.
