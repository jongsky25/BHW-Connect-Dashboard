# PSGC crosswalk report (E4.1)

Table: `dim_psgc_crosswalk`. Migration: `supabase/migrations/20260721060000_e4_1_psgc_crosswalk.sql`.
Builder / reconciler: `ingestion/build_psgc_crosswalk.py` — re-run it to refresh this report.

## What this is for

`dim_geo` is fixed on one PSGC vintage (`2023 series (>=2024 release, includes NIR)`). Every
later external load in Phase E4 (POPCEN 2024 / CPH 2020, SAE 2021 poverty, DOF/BLGF 2024 income
classes, DOH facilities) arrives keyed on **its own** PSGC vintage. A code that was renumbered or
reassigned between that vintage and dim_geo's would silently fall out of a naive join.
`dim_psgc_crosswalk` maps a source-vintage code (`old_code`) onto dim_geo's current code
(`new_code`); a load resolves its codes through `map_psgc_to_dim_geo(code)` **first**, and every
code that resolves to nothing is reported (this document's discipline), never dropped. This is
insurance against silent join loss, not analysis — it is the piece the rest of Phase E4 depends on.

## The resolution primitive

`map_psgc_to_dim_geo(p_code text, p_old_vintage text default null) → text` (SQL) and its Python
twin `map_code()` in the builder:

1. **Direct hit** — `p_code` is already a live `dim_geo.geo_code` → return it unchanged.
2. **Crosswalk hit** — `p_code` matches a `dim_psgc_crosswalk.old_code` → return its `new_code`.
3. **Unresolved** — return `NULL`; the caller logs it (two-way reconciliation).

Direct-hit is checked first, and the seeded `old_code`s are verified **not** to collide with any
live `dim_geo` code (0 collisions, below), so a stale code can never short-circuit a real one.

## Seeded change: Negros Island Region (NIR / Region XVIII), RA 12000 (2024)

This is the one large PSGC vintage change the repo already carries hard evidence for. Pre-NIR PSGC
filed **Negros Occidental** under Region VI (`06`) and **Negros Oriental** + **Siquijor** under
Region VII (`07`); dim_geo (post-NIR) files all three under Region `18` with re-prefixed codes —
the exact remap `ingestion/reconcile_boundaries.py` already applies for boundary polygons
(`NIR_PROVINCE_CROSSWALK`). The crosswalk rows are derived **from dim_geo itself** (the join target
of truth), by swapping each geo's region prefix back to its pre-NIR region while preserving the
province digits:

| dim_geo (new) | pre-NIR (old) | province |
| --- | --- | --- |
| `18045…` | `06045…` | Negros Occidental → Region VI |
| `18046…` | `07046…` | Negros Oriental → Region VII |
| `18061…` | `07061…` | Siquijor → Region VII |

`change_kind = 'region_reassignment'`; names are unchanged by NIR, so `old_name = new_name`.

## Reconciliation summary

- **Total rows:** 1,357 — provinces 3, citymuns 62, barangays 1,292.
- **`new_code` orphans** (a `new_code` not present in `dim_geo`): **0**. Every target is a real geo.
- **`old_code` collisions** (an `old_code` that already exists as a live `dim_geo` code): **0**.
  The derived pre-NIR codes are disjoint from dim_geo, so direct-hit resolution is unambiguous.

Row count is exact against the live `dim_geo` (which includes the 12 NIR barangays added by the
StepZero patch, `stepzero_only_v1`, that the source parquet alone does not carry — one reason the
crosswalk is derived from `dim_geo`, not the parquet).

## Accepted gap: Bacolod City (HUC)

`dim_geo` carries a **fourth** Region-18 province row, `18302` "CITY OF BACOLOD (HUC)" (1 province +
1 citymun + 61 barangay rows), modeled as both a province-level and a citymun-level geo because it
is a Highly Urbanized City independent of any province. `reconcile_boundaries.py`'s NIR crosswalk
deliberately excluded it (an HUC's pre-NIR code is not a clean region-prefix swap of its post-NIR
one), and this crosswalk excludes it for the same reason: its pre-NIR code cannot be derived by rule
from data already in the repo. It is a **flagged gap**, not a silent one — when a downstream source
carries Bacolod on a pre-NIR vintage, `map_psgc_to_dim_geo` returns `NULL` for it and the load's own
reconciliation report will surface it for a manual PSA-file cross-check. This matches the
established discipline ("prefer crosswalking codes over switching sources blindly", but never guess
a code — accept and document the gap).

## Not seeded yet: the general quarterly-file path

The plan's nominal source is the **quarterly PSA PSGC publication** datafile: diff two snapshots
(old vintage vs new) into `created` / `abolished` / `renamed` / `renumbered` rows. That mechanism
is implemented and self-tested in `build_psgc_crosswalk.py` (`diff_psgc_publications()`,
`--selftest`), but the PSA site (`psa.gov.ph/classification/psgc`) is Cloudflare bot-challenged from
the build environment (returns a `403` challenge — the constraint the plan flagged: "research pass
hit bot-blocks"). No snapshot is bundled, so `dim_dataset.status` for `psa-psgc-crosswalk` stays
`draft`. When a real quarterly file is obtainable, normalize both snapshots to
`{code, name, level, correspondence_code?}` records and feed them via `--old-psgc` / `--new-psgc`;
the diff rows fold in alongside the NIR block and this report regenerates. Other well-known PSGC
vintage changes (e.g. the 2022 Maguindanao del Norte / del Sur split, various component-city → HUC
conversions) are intentionally **not** hand-seeded here — they require the real correspondence
column from the PSA file, and guessing codes is exactly what this discipline forbids.
