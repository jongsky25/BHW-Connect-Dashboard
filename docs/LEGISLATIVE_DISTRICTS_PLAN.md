# Legislative districts — ingestion, public correction, and use (plan)

Adds the **congressional (legislative) district** as a first-class analytical dimension: ingest the
district↔LGU mapping, publish exactly how it was built and let the public correct it, then use it
across the aggregates, the pages, the exports and the AI layer.

Status: **plan only.** No migration, no ingestion script, no page has been written. This document
is the reference the implementation follows, in the sense of `docs/BUILD_PLAN.md` §0.

Why it is worth doing: every downstream consumer of this dashboard — a representative's staff, a
DOH regional office reading the 2027 Budget Cue Cards corpus (`docs/AI_ASSISTANT_PLAN.md` §12), a
health advocacy group — acts on **districts**, because that is the unit that has a budget and a
legislator attached. Today the dashboard can answer "how many BHWs in Leyte" and "how many in
Palo", but not "how many in the district Rep. X represents", which is the question that most often
turns a figure into a decision.

---

## 0. Decisions — settled 2026-09-02

All five were put to the owner with a recommendation and all five recommendations were accepted.
They are recorded here as decisions, not open questions; a change to any of them is a
`docs/DECISIONS.md` entry, not an edit to this list.

1. **Vintage — 20th Congress (2025–2028) only.** `congress_no` is in the schema from the start, so
   backfilling the 17th–19th later is a load, not a migration. Nothing is sourced for them now.
2. **Correction posture — proposals only, no exceptions.** No trusted-contributor role, no direct
   write path. D2.3 explains why the review queue is the whole product here.
3. **Publishing the mapping as a download — yes, after D2 ships.** District CSV/XLSX joins
   `/api/export` only once the mapping is publicly correctable, so we never hand out a derived
   grouping that has no route back to us when it is wrong.
4. **Named representatives — yes, in their own table.** `district_representative`, with its own
   `as_of` date and its own correction path. Never a column on `dim_legislative_district`: it is
   the most useful field on the page and also the one most likely to be stale or contested, and
   giving it a separate clock is what keeps a stale representative from ageing the district row.
5. **Boundary polygons — derive by dissolving citymun boundaries.** Multi-district cities stay
   hatched with the ranked-list fallback, exactly as `docs/BOUNDARY_RECONCILIATION.md` already
   handles every other missing polygon (D3.2).

One sequencing note carried from the same discussion: **D1.1 (ask BetterGov.PH) happens before any
build work.** If their mapping is publishable it collapses the hardest increment into a load, and
it costs half a day to find out.

**D1.1 is now done — see §4. The answer was no, and the half day paid for itself anyway:** their
mapping is not loadable, but chasing it surfaced COMELEC precinct returns as a barangay-grain
district source, which is a better answer to the multi-district-city problem than the one this
plan was written around. No owner decision changes.

---

## 1. The modelling decision: a district is not a `geo_level`

The tempting move is `alter type geo_level_enum add value 'district'` and a row in `dim_geo`. It
must not be done, for four separate reasons, each of which is sufficient on its own:

1. **It is a second partition, not a level of the existing tree.** `dim_geo` is one containment
   chain (`national → region → province → citymun → barangay`) and every `agg_*` table keys on
   `geo_code` with `geo_level` alongside it. Districts cut across that chain: they sit _below_
   province and _above_ citymun for most of the country, but _below_ citymun and _above_ barangay
   inside the ~34 multi-district cities. There is no single insertion point.
2. **The grain is mixed by construction.** Leyte's 1st is a set of municipalities; Quezon City's
   3rd is a set of 37 barangays. A `parent_code` column cannot express both.
3. **It is time-varying.** 253 districts in the 19th Congress, 254 in the 20th, and new ones are
   created by individual Republic Acts mid-term. `dim_geo` is explicitly pinned to one PSGC
   vintage (`docs/PSGC_CROSSWALK.md`); districts have a different clock, and mixing the two clocks
   in one table is how a 2022 figure silently gets a 2025 denominator.
4. **It is not authoritative data.** Every row in `dim_geo` traces to a PSA publication. The
   district mapping will be assembled from community sources and public corrections. Putting a
   corrected-by-strangers row in the same table as PSA geography erases a distinction the whole
   trust posture of this dashboard rests on.

So: **two new tables beside `dim_geo`, never inside it**, and `geo_level_enum` is untouched.

### 1.1 Why the district code is a slug, not a PSGC-derived code

The obvious code is `<province geo_code>-<ordinal>`. It breaks on the real cases: **Taguig–Pateros**
spans a city and a municipality; several districts pair an independent city with a province for
representation while the city is administratively separate (Tacloban votes with Leyte's 1st but is
a province-level row in `dim_geo`); lone districts have no ordinal in common usage. A code that
encodes a parent asserts a parentage that is sometimes false.

Use a stable slug — `leyte-1st`, `quezon-city-3rd`, `taguig-pateros-2nd`, `batanes-lone` — plus a
`wikidata_qid` for machine identity, and keep `parent_geo_code` as a **nullable convenience**
column that is null exactly when the district spans more than one province-level geo.

---

## 2. Sources and their standing

Researched and verified against the live sources; the findings that constrain the design:

| Source                                                                        | What it gives                                                                                     | Verified standing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSA PSGC**                                                                  | Nothing.                                                                                          | The `district` level in PSGC is the **4 NCR districts of Manila only** — confirmed against the PSGC API (4 rows) and altcoder's "ProvDists" shapefile layer. There is no national legislative-district dimension in PSGC.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Wikipedia** — `Legislative districts of <Province>` + per-district articles | Composition, at both grains.                                                                      | **Primary source.** Province pages carry a `{{Collapsible list}}` of constituent LGUs as _disambiguated_ wikilinks (`[[Palo, Leyte\|Palo]]`); district articles carry the barangay roster in the infobox `\|towns =` field (Quezon City's 3rd returned all 37). Fetchable via `action=parse&prop=wikitext`. CC BY-SA 4.0.                                                                                                                                                                                                                                                                                                                                                       |
| **Wikidata**                                                                  | The district registry.                                                                            | 256 items of `wd:Q96020121` with stable QIDs, labels, populations. **Only 2 of 256 carry `P527` (has part)** — membership is not modelled, so it cannot supply the mapping. PH municipalities carry no PSGC property either, so it does not shortcut the join. CC0.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **PSA 2020 CPH — "Highlights on the Population of Legislative Districts"**    | Official district roster + population per district (253, as of 31 Aug 2021).                      | **Validation set, not source.** PSA is Cloudflare-blocked from the build environment (403), same constraint `ingestion/build_psgc_crosswalk.py` already documents; download by hand into `ingestion/data/` like every other PSA file here.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **BetterGov.PH**                                                              | Two files, not one, in `bettergovph/open-data-visualization`; neither is the advertised artifact. | **Investigated in full (D1.1) — do not load.** `static/data/districts.json` is derived from DPWH project caches and fails our own D1.5 gates (Quezon City's 1st and 3rd are identical 115-barangay lists; Palo is filed under Leyte's 4th, not its 1st). `static/data/districts_generated.json` is sound but is really a COMELEC derivative — see the row below. The "7,418 barangays" is a separate PSGC city→barangay roster carrying no district on any row. No LICENSE; README restricts to "educational and research purposes", which cannot be republished under our CC BY 4.0 commitment (§8).                                                                           |
| **COMELEC 2025 precinct election returns**                                    | Barangay-grain district membership, from the ballot itself.                                       | **New primary-grade source, found via D1.1.** Each precinct return names the contest it voted in (`MEMBER, HOUSE OF REPRESENTATIVES - <DISTRICT>`), so the district is read off actual ballots rather than inferred from prose. BetterGov's `extract_districts_from_elections.py` demonstrates the technique against `klescosia/ph-elections2025`, yielding 1,627 municipalities, 220 province-level districts and correct barangay splits for 12 multi-district cities (Quezon City: 142 barangays, 3rd District = 37 — matching both the true count and our own Wikipedia reading). `ph-elections2025` has no LICENSE, so crawl COMELEC directly rather than depending on it. |
| **`jgngo/psgc-data`**                                                         | `csv/muncity.csv` has a literal `district` column per city/mun.                                   | Stale (README: 81 provinces / 145 cities — pre-2022, against today's 82/149), 9-digit codes, no barangay grain, no stated licence. Useful only as a **third opinion** in the disagreement report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **OpenStreetMap**                                                             | Real district geometry (`boundary=political` + `political_division=congressional_district`).      | Coverage unverified — Overpass is unreachable from this environment (connection reset at the proxy, three mirrors). **ODbL share-alike conflicts with the CC BY 4.0 commitment** for published aggregates. Not recommended as a source.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Conclusion:** Wikidata for the registry, Wikipedia for the composition, **COMELEC 2025 precinct
returns as the second independent opinion at both grains**, PSA for validation. The mapping is
derived, not official, and every surface must say so.

The two-source rule that follows from D1.1: **no district assignment ships on one source alone.**
Wikipedia and COMELEC are independent in the way that matters — one is edited prose, the other is
the contest printed on a ballot — so where they agree the assignment is safe, and where they
disagree it belongs in the disagreement report rather than in the mapping. The single worst
outcome available here is a plausible mapping nobody cross-checked, which is exactly what
BetterGov's `districts.json` turned out to be.

---

## 3. Schema

Four tables and one enum-free design, following the conventions already load-bearing in this repo:
RLS enabled in the same statement block as the `CREATE TABLE` (`docs/DECISIONS.md` 0.3 guardrail),
`status` gating with `auto`/`approved`/`rejected` as in `dataset_registry`, and a provenance
pointer that is `NOT NULL` as in `kb_node`.

```sql
-- One row per district per Congress.
create table dim_legislative_district (
  district_code   text primary key,            -- 'leyte-1st', 'quezon-city-3rd', 'batanes-lone'
  congress_no     smallint not null,           -- 20 = 2025-2028
  district_name   text not null,               -- as published by the source
  ordinal         smallint,                    -- null for a lone district
  is_lone         boolean not null default false,
  parent_geo_code text references dim_geo (geo_code),  -- null iff the district spans parents
  region_code     text,                        -- convenience for filtering; null if it spans
  wikidata_qid    text,
  psa_population  integer,                     -- PSA 2020 CPH district population (validation)
  valid_from      date not null,
  valid_to        date,                        -- null = current
  source_kind     text not null check (source_kind in ('wikidata','wikipedia','psa','manual','public_correction')),
  source_ref      text not null,               -- QID, or 'wikipedia:<page>@<revid>'
  retrieved_at    timestamptz not null,
  status          text not null default 'auto' check (status in ('auto','approved','rejected')),
  unique (congress_no, district_name)
);

-- Membership, at whatever grain the district is actually defined at.
create table geo_district_map (
  id             bigint generated always as identity primary key,
  district_code  text not null references dim_legislative_district (district_code) on delete cascade,
  geo_code       text not null references dim_geo (geo_code),
  geo_level      geo_level_enum not null check (geo_level in ('citymun','barangay')),
  -- How this row's geo_code was resolved. Never guessed: see D1.4.
  match_method   text not null check (match_method in ('exact','disambiguated','crosswalk','manual_override','public_correction')),
  source_kind    text not null,
  source_ref     text not null,                -- 'wikipedia:Legislative districts of Leyte@1234567890'
  retrieved_at   timestamptz not null,
  superseded_by  bigint references geo_district_map (id),  -- corrections supersede, never overwrite
  status         text not null default 'auto' check (status in ('auto','approved','rejected')),
  reviewed_at    timestamptz,
  reviewed_by    text,
  review_note    text
);

-- One live membership row per (district, geo): a partial unique index, because the constraint
-- only applies to rows that have not been superseded.
create unique index geo_district_map_live_idx
  on geo_district_map (district_code, geo_code)
  where superseded_by is null;

-- The sitting representative, on its own clock (decision 4). Separate from the district row so a
-- stale or contested name never ages the district itself, and so it can be corrected on its own.
create table district_representative (
  id            bigint generated always as identity primary key,
  district_code text not null references dim_legislative_district (district_code) on delete cascade,
  congress_no   smallint not null,
  full_name     text not null,
  party         text,
  as_of         date not null,
  source_kind   text not null,
  source_ref    text not null,
  superseded_by bigint references district_representative (id),
  status        text not null default 'auto' check (status in ('auto','approved','rejected'))
);

-- Public correction proposals. Public-insert-only, exactly like `feedback`.
create table district_correction (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  session_id      uuid not null,
  action          text not null check (action in ('add','remove','move','rename','other')),
  district_code   text references dim_legislative_district (district_code),
  to_district_code text,                       -- for 'move'
  geo_code        text references dim_geo (geo_code),
  rationale       text not null check (char_length(rationale) <= 2000),
  evidence_url    text,                        -- RA number, COMELEC page, PSA release
  submitter_email text,                        -- never published; contact-back only
  status          text not null default 'open' check (status in ('open','accepted','rejected','duplicate')),
  reviewed_at     timestamptz,
  reviewed_by     text,
  review_note     text                         -- published verbatim on the transparency page
);
```

Three properties worth being explicit about:

- **`source_ref` carries a revision id, not a URL.** `wikipedia:Legislative districts of Leyte@1234567890`
  is checkable years later; a bare URL is not, because the page will have changed. This is the
  single cheapest thing that makes the transparency page in §5 mean something.
- **Corrections supersede; nothing is overwritten.** An accepted correction inserts a new
  `geo_district_map` row and sets `superseded_by` on the old one. The history _is_ the audit trail,
  and the transparency page renders it directly.
- **`review_note` on `district_correction` is public.** A rejection whose reason nobody can read is
  indistinguishable from being ignored — the same argument `supabase/migrations/20260827120000_kb_review.sql`
  makes about rubber-stamped approvals, pointed the other way.

---

## 4. Phase D1 — Ingestion

### D1.1 — Ask BetterGov.PH first — **done 2026-09-02. Answer: no, but read on.**

The question was whether BetterGov.PH's advertised mapping (256 districts, 85 provinces, 22 cities,
7,418 barangays, 416/417 members — 99.8%) is a file we could load instead of deriving one. It is
not. The investigation is recorded here in full because the negative result is load-bearing: it is
what justifies spending 2–3 days on D1.3 rather than half a day on a loader.

**The advertised mapping is not one file, and it is not published as a dataset.** It lives as two
JSON files inside `bettergovph/open-data-visualization` — a 34,000-file application repo, not a
data repo — and the two have different provenance and sharply different quality. The earlier
finding that it was absent from their 36 public repos was right about `open-congress-data`; this
repo is the one that has it.

**1. `static/data/districts.json` — looks like the advertised artifact, and must not be used.**
It carries 22 cities, matching their "22 cities" claim exactly, which is what makes it the
tempting one. Its own metadata says it is `"derived from combined public project caches"` — DPWH
project locations, not a district roster — and `"Municipality and barangay lists reflect observed
project locations"`. It fails our own D1.5 gates on inspection:

- **Quezon City's 1st and 3rd Districts are the same 115-barangay list**, 100% overlap, and the
  2nd, 4th, 5th and 6th are all the same 5-barangay placeholder. 118 distinct barangays against
  QC's actual 142. This is guardrail #3's double-count trap already realised in the data.
- **Palo is filed under Leyte's 4th District.** It is in Leyte's 1st, with Tacloban, Alangalang,
  Babatngon, San Miguel, Santa Fe, Tanauan and Tolosa.
- Its self-description is stale too: `total_districts: 162`, `"26 provinces"`, `"5 cities"`,
  against a payload of 115 entities. A file whose own header disagrees with its body cannot be a
  source for anything.

**2. `static/data/districts_generated.json` — sound, and not really BetterGov's data at all.**
86 provinces, 1,627 municipality rows, 220 province-level districts, plus correct barangay-grain
splits for 12 multi-district cities (1,774 barangay rows). Every spot check passed: Leyte's 1st
(all 8 municipalities), Pampanga's 2nd (6) and 3rd (5). **Quezon City comes out at 142 barangays
with the 3rd District holding 37** — the true barangay count, and the same 37 our own Wikipedia
reading returned.

The reason it is good is the reason it is not a shortcut: `scripts/extract_districts_from_elections.py`
builds it from **COMELEC 2025 precinct-level election returns**, reading the
`MEMBER, HOUSE OF REPRESENTATIVES - <DISTRICT>` contest each precinct actually voted in. The
district comes off the ballot. That is a source, not a mapping — and it is one we should use
ourselves (§2, and D1.4 below).

**3. The 99.8% figure is a conflation of two different files.** `city_barangays_mapping.json` is a
plain PSGC city→barangay roster — exactly 136 cities and 7,418 barangays, matching the advertised
number precisely — but **no row in it carries a district**. The barangays actually mapped to a
district number 1,818 in the unusable file and 1,774 across 12 cities in the good one. Neither is
7,418. The claim is not dishonest so much as two counts added together.

**4. Licensing settles it independently.** `open-data-visualization` has no LICENSE file; its
README states the project is `"for educational and research purposes"` and asks users to respect
upstream terms. That is not an open licence, and §8 commits us to CC BY 4.0 for published
aggregates. Upstream `klescosia/ph-elections2025` has no LICENSE either — which is why D1.4 crawls
COMELEC directly rather than depending on it.

**What this changes.** D1.3 stays a build, at its original estimate. What improves is D1.4: we now
have a second, independent, barangay-grain source, current to 2025 and traceable to a ballot,
where the plan previously had only Wikipedia infoboxes and a stale `jgngo/psgc-data` third
opinion. The multi-district city — the hardest part of this phase — is the case COMELEC returns
answer best, because a precinct's congressional contest is exactly the fact we are trying to
recover. That is worth more than the loader we did not get.

**The outstanding ask to BetterGov.PH is now a licence question, not a data question** — whether
they will put `districts_generated.json` under CC0 or CC BY so it can serve as a citable
corroboration source. Draft issue text: `docs/bettergov-district-mapping-issue.md`. It is not on
the critical path; D1.2 onward proceed regardless.

### D1.2 — Migration: the four tables — **done 2026-09-02.**

Schema above, applied via the Supabase MCP as `20260902030000_legislative_districts.sql`, with the
per-table reasoning carried in comments as every other migration here does. No data.

RLS decided per table and verified as `anon` against the live project: the three mapping tables are
public-read gated on `status <> 'rejected'` (`auto` rows readable, because D1 loads at `auto` and
D2.1 renders immediately), superseded rows stay visible because D2.2 publishes the history, and
`district_correction` is insert-only with no SELECT policy exactly as `feedback` is.

**One constraint this hands D2.5:** the public ledger cannot read `district_correction` from the
client, because `submitter_email` is on the table. It needs a server-side route projecting only the
publishable columns. Relaxing the policy is the wrong fix. See `docs/DECISIONS.md`, 2026-09-02.

### D1.3 — `ingestion/build_legislative_districts.py` (2–3 days)

Modes mirroring `build_psgc_crosswalk.py` so it is operable the same way:

```
--selftest                 # synthetic fixtures, no network, no DB
--fetch --snapshot-dir …   # pull wikitext + Wikidata + COMELEC returns, snapshots to ingestion/data/
--from-snapshot …          # build from snapshots (the reproducible path CI can run)
--emit-sql-dir … | --database-url …
--write-doc-summary        # refresh docs/LEGISLATIVE_DISTRICTS.md's reconciliation section
```

Two sources are fetched, not one (D1.1): Wikipedia/Wikidata as before, and **COMELEC 2025
precinct returns**, from which each precinct's `MEMBER, HOUSE OF REPRESENTATIVES - <DISTRICT>`
contest gives a barangay→district fact directly. Roll the precinct facts up to barangay, then to
municipality, and carry both grains. PSA remains validation only.

**Snapshots are committed.** The raw wikitext for every page fetched goes to
`ingestion/data/wikipedia_districts_<congress>/`, with its revid; the COMELEC returns go to
`ingestion/data/comelec_returns_2025/` alongside them. The build must be reproducible
without the network, and it must be possible to diff _why_ a mapping changed between two runs —
which is also what makes a public correction reviewable against the source we actually used.

### D1.4 — Resolution: name → `geo_code`, and never a guess (inside D1.3)

Order of attempts, each recorded as `match_method`:

1. **`exact`** — normalised name matches exactly one `dim_geo` citymun within the province scope.
2. **`disambiguated`** — the wikilink target carries the province (`[[San Miguel, Leyte|…]]`) and
   that resolves to exactly one row. This is why wikitext is parsed rather than rendered HTML: the
   rendered page shows "San Miguel", the wikitext shows which one.
3. **`crosswalk`** — resolve through the existing `map_psgc_to_dim_geo()` where the source name
   corresponds to a pre-NIR or pre-Maguindanao-split entity.
4. **`manual_override`** — a small committed table in the script, each entry carrying a one-line
   reason. Expected members: Isabela City/Basilan, Cotabato City, the HUC-votes-with-province cases.
5. **Unresolved** — reported, never dropped and never fuzzy-matched. Fuzzy matching a place name
   into a district assignment is exactly the failure this repo's two-way reconciliation discipline
   exists to prevent; an unresolved LGU is a visible gap, a wrongly-matched one is a silent lie.

### D1.5 — Validation gates (inside D1.3; the build fails if these fail)

- District count equals the expected count for the Congress (254 for the 20th) — Wikidata roster
  and Wikipedia pages must agree with each other before either is trusted.
- **Every citymun in `dim_geo` is covered exactly once**, either directly or via its barangays.
  Report both directions: uncovered LGUs, and LGUs claimed by two districts.
- For each multi-district city, the union of its districts' barangays equals that city's barangay
  set in `dim_geo`; a leftover barangay is a hard failure, not a warning.
- **Population reconciliation against PSA.** For province-level districts, the sum of member
  citymun populations from `agg_population` must land within a stated tolerance of the PSA 2020 CPH
  district population. This is the check that actually catches a bad match — a municipality
  assigned to the wrong district moves both districts' totals in opposite directions.
- Party-list seats are excluded by construction; assert the count of them is zero.
- **Wikipedia and COMELEC agree on every shipped assignment.** Disagreements are written to the
  disagreement report and the LGU is left unresolved, never silently resolved in favour of either.
  This gate is the one that would have caught both of BetterGov's failures — Palo's district and
  Quezon City's duplicated barangay lists — before they reached a page.

Outputs `ingestion/_qa_report_legislative_districts.json` and generates
`docs/LEGISLATIVE_DISTRICTS.md` — the same "the report is the doc" pattern as
`docs/PSGC_CROSSWALK.md` and `docs/BOUNDARY_RECONCILIATION.md`.

### D1.6 — Register the dataset (half a day)

A `dim_dataset` row (`slug = 'ph-legislative-districts'`, licence, `source_url`, `as_of_date`,
`methodology_md`) — which is also what versions the AI caches in §6.4 — plus `dataset_registry` +
`dataset_column` rows at `exposure = 'public'`, and `kb_node`/`kb_edge` lineage: the tables
`built-by` the migration, `derived-from` the Wikipedia/Wikidata source nodes, `reconciled-in`
`docs/LEGISLATIVE_DISTRICTS.md`. Nodes land `origin = 'asserted'` (they come from committed files).

---

## 5. Phase D2 — The transparency page and public correction

### D2.1 — `/districts` (public, 2 days)

The index: all 254 districts, filterable by region, each showing member LGU count, BHW total,
population, and a **match-quality badge** (all-exact / has-overrides / has-unresolved).

Above the table, stated plainly and not in a footnote: _this mapping is derived from public
sources, not published by PSA or COMELEC; here is how it was built; here is how to correct it._

### D2.2 — `/districts/[districtCode]` (2 days)

Per district: the member list, and **for every single row** — the source page, the revision id it
came from, the `match_method`, and any override reason. A row that came from an accepted public
correction says so, and links the proposal. This is the "transparent page of how we grouped it"
the whole phase is named for: not a methodology essay, but a per-row receipt.

Also on this page: the **unresolved and disputed lists**, published rather than hidden — the same
posture `/data-quality` already takes ("a missing number reads as a known finding rather than a
hidden one").

### D2.3 — Correction submission (2 days)

A structured form, not free text: _action_ (add / remove / move / rename), _which LGU_, _which
district_, _evidence URL_, _why_. Structured because a proposal has to be diffable against the
current mapping and applyable without re-interpretation; free text becomes a triage queue nobody
works, which is the failure mode `docs/AI_ASSISTANT_PLAN.md` §7 warns about.

Reuses the `feedback` route's existing defences verbatim: honeypot field, rate limit, session id,
2,000-char cap, email optional and never published. It is a **separate table** from `feedback`
because it is a structured proposal with a review lifecycle, not a message.

### D2.4 — Admin review queue (2 days)

`/admin/(dashboard)/district-corrections`, modelled on the existing `kb-review` surface: accept /
reject / duplicate, with `reviewed_by`, `reviewed_at` and a mandatory `review_note`. Accepting
writes the superseding `geo_district_map` row with `match_method = 'public_correction'` and
`source_ref` pointing at the proposal id, then triggers §6.1's roll-up rebuild.

### D2.5 — The public ledger (1 day) — **done 2026-09-05.**

`/districts/corrections`: every proposal ever submitted, its status, and its review note. Accepted
ones link to the row they changed. **This is the part that makes the correction mechanism credible
rather than decorative** — a submission box with no visible disposition trains people to stop
submitting.

Privacy: submitter email is never rendered; the rationale text is public and the form says so
before submission.

Built as specified. Four things worth recording here rather than only in `docs/DECISIONS.md`:

- **`open` is a published status, not a waiting room.** The plan says "every proposal ever
  submitted", and an unjudged proposal is exactly what a submitter checking on their own report
  needs to see. Hiding it until it has an outcome would reproduce the black box in miniature.
- **`reviewed_by` is not published, `review_note` is.** The constraint the ledger inherits is about
  submitters' addresses; satisfying it by publishing an admin's address instead would be an odd
  trade. The reasoning is the accountable part.
- **"The row they changed" exists for two of the five actions.** `add` and `move` write a
  `geo_district_map` row carrying `source_ref = 'district_correction:<id>'`, which is what the
  ledger joins on. An accepted `remove` marks the existing row rejected (invisible to public reads
  by policy) and a `rename` touches `dim_legislative_district`, so those say in words what changed
  and link the district page instead of a row.
- **Neither a submission nor a review waits out the 1-hour ISR window.** The submission route and
  the admin's judge action both `revalidatePath('/districts/corrections')`. A ledger that is an
  hour behind the promise made on the form is a smaller black box, not none.

### D2.6 — Changelog + cache invalidation (half a day)

Every accepted correction writes a `changelog_entries` row (it already surfaces on `/methodology`)
and bumps `dim_dataset.last_updated_at` for `ph-legislative-districts`, which is what expires the
AI answer caches keyed on that slug (§6.4).

---

## 6. Phase D3 — Using the data

### D3.1 — Aggregates: roll up from the finest grain, never from citymun totals

`agg_bhw_by_district`, keyed `(dataset_id, district_code)`, plus the same for the UUC-PHC and
profiling-status datasets once the first one is proven.

The one arithmetic trap, stated once so it is never re-discovered: **a multi-district city's BHW
count must be summed from its barangay rows, not from its citymun row.** Rolling up citymun totals
would assign Quezon City's entire headcount to whichever district matched first, or to all six.
The rule is: resolve each district to its **leaf set** (barangays), aggregate from the leaf grain,
and assert that the sum over all districts equals the national total. That assertion is cheap and
it catches every double-count.

Suppression is unchanged (n < 5 on individual-level breakdowns) but will rarely bite: districts
average ~1,200 BHWs. Where it does, the existing `is_suppressed` path handles it.

**Denominators:** per-capita district figures use PSA's _published district population_, not a
sum of member populations — `agg_population` stops at citymun (no barangay population), so a
multi-district city cannot be split. Where PSA's district population is missing, the figure is
withheld rather than approximated.

### D3.2 — Boundaries

Derive district polygons by dissolving the citymun polygons already reconciled in
`docs/BOUNDARY_RECONCILIATION.md`. Two known outcomes, both acceptable under the existing policy:
multi-district cities have no barangay polygons in the source, so they render hatched with the
ranked-list fallback; and NCR's four district polygons already exist in the source (they are the
reason NCR provinces show as "missing" in the current report) and can be used directly.

### D3.3 — Surfaces

- `/districts` and `/districts/[code]` from D2 become full profile pages — the same figure set as
  `/place/[geoLevel]/[geoCode]`.
- `/explore`: district as a filter dimension and as a map layer.
- `/compare`: district vs district, which is the comparison a legislative office actually wants.
- Exports: district CSV/XLSX/PNG/PPTX through the existing `/api/export` routes, plus the mapping
  itself as a download (owner decision 3).
- `/api/geo/search`: districts become searchable by name and by member LGU, so "Palo" surfaces
  "Leyte's 1st".

### D3.4 — The AI layer

Four concrete changes, in dependency order:

1. **Registry, not new tools.** `agg_bhw_by_district` and the two district tables get
   `dataset_registry` rows at `exposure = 'public'`, with `grain` spelled out ("one district ×
   dataset"). The generic `queryDataset` tool then answers district questions with no new code —
   which is the ceiling `docs/AI_ASSISTANT_PLAN.md` §8 built the registry to break.
2. **A provenance rule in the system prompt.** District figures are derived from a
   community-maintained mapping. Any answer that uses one must name the Congress it is for and say
   the grouping is derived and correctable — the same class of rule as the existing suppression
   instruction. This is not politeness: a district figure quoted without its vintage is wrong the
   moment a new RA splits the district.
3. **Cache versioning is already free.** Keying on `dataset_slug = 'ph-legislative-districts'` means
   an accepted correction invalidates district answers and nothing else, via the mechanism
   `lib/ai/dataset-scope.ts` already implements.
4. **Regression cases.** Add to `ai_regression_case`: a straight lookup ("BHWs in Leyte's 1st"), a
   multi-district city ("Quezon City's 3rd" — the double-count trap), a district with an
   unresolved member (the answer must disclose the gap), and a vintage question ("which district
   is X in" for an LGU moved by a correction). These are the four ways this dimension can produce
   a fluent wrong answer.

**What the district dimension unlocks for the AI, specifically:** the 2027 Budget Cue Cards corpus
(`docs/AI_ASSISTANT_PLAN.md` §12) is organised around budget lines that are argued district by
district. Once districts exist as nodes with `kb_edge` links to their member geographies, the
traversal can connect a budget claim to the BHW headcount it is about — which is the first
question in this repo that neither the numeric layer nor the document layer can answer alone.

---

## 7. Guardrails (additions to the pitfall register)

1. **Never fuzzy-match a place name into a district.** Unresolved is a published finding; a wrong
   match is an invisible one.
2. **Never ship a district assignment that only one source attests.** Two independent sources or it
   is unresolved (D1.5). A mapping that looks complete because nobody cross-checked it is the
   specific failure D1.1 found in the field.
3. **Never roll up a multi-district city from its citymun row.** Assert the district sum equals the
   national total on every build.
4. **Never render a district figure without its Congress.** The dimension is time-varying; a figure
   without a vintage is undated.
5. **Never let a correction write directly.** Proposals only; supersede, never overwrite.
6. **Never present the mapping as official.** PSA and COMELEC do not publish it in this form. Every
   surface says so, including the export's header row and the dataset's `methodology_md`.
7. **Never mix district provenance into `dim_geo`.** The line between PSA-sourced geography and
   derived, correctable grouping is the trust boundary this whole feature sits on.

---

## 8. Licensing

The mapping is a set of **facts** (which municipality is in which district), assembled from
Wikipedia's CC BY-SA 4.0 text. Facts are not themselves copyrightable, so publishing the derived
mapping under the repo's CC BY 4.0 commitment is defensible — but the honest and cheap thing is to
attribute per row anyway (the `source_ref` revision id already does this) and to state the source
and its licence on `/districts` and in `dim_dataset.license`. **Do not copy Wikipedia prose** into
the pages; write our own. **Do not use OSM** as a source — ODbL's share-alike would attach to the
published mapping and conflict with the CC BY 4.0 promise.

---

## 9. Definition of done

**D1.** 254 districts loaded for the 20th Congress; every `dim_geo` citymun covered exactly once;
population reconciliation within tolerance against PSA with every residual documented;
`docs/LEGISLATIVE_DISTRICTS.md` generated; `--selftest` and the from-snapshot build both green in
CI; dataset registered and lineage seeded.

**D2.** `/districts` and `/districts/[code]` live with per-row provenance including revision ids;
correction form live with the `feedback` route's defences; admin queue live with mandatory review
notes; public ledger live; an accepted test correction visibly flows through to a superseding row,
a changelog entry and an invalidated cache.

**D3.** District aggregates whose sum equals the national total (asserted in a test); district
filter, compare and export working; four regression cases green; the system prompt's provenance
rule covered by a regression case that fails if the disclosure is dropped.

Standard for every increment, per `docs/BUILD_PLAN.md` §5: `npm run lint`, `npm run typecheck`,
`npm test` clean, new tests mutation-checked, and a dated `docs/DECISIONS.md` entry for any
deviation from this document.

---

## 10. Sequencing and effort

| Phase                        | Increments | Estimate | Blocks on            |
| ---------------------------- | ---------- | -------- | -------------------- |
| D1 Ingestion                 | D1.1–D1.6  | ~5 days  | Owner decisions 1, 4 |
| D2 Transparency + correction | D2.1–D2.6  | ~8 days  | D1                   |
| D3 Use                       | D3.1–D3.4  | ~7 days  | D1 (D3.3 also on D2) |

D1 and D2 are the ones that have to be done in order — the correction mechanism is meaningless
until there is a mapping to correct, and publishing an uncorrectable derived mapping is worse than
publishing nothing, because it looks authoritative. D3's aggregate work (D3.1) can start as soon as
D1 lands.
