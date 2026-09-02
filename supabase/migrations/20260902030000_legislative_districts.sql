-- Legislative districts, Increment D1.2 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §3).
--
-- Four tables beside dim_geo, never inside it. The plan's §1 argues the case at length; the two
-- reasons that constrain THIS file are worth repeating where the schema lives:
--
-- 1. A district is a second partition, not a level of the dim_geo containment chain. It sits below
--    province and above citymun for most of the country, but below citymun and above barangay
--    inside the ~34 multi-district cities. geo_level_enum is therefore untouched, and membership
--    (geo_district_map) carries its own grain per row rather than inheriting one.
-- 2. dim_geo rows trace to a PSA publication; these do not. This mapping is derived from community
--    sources and public corrections, and mixing the two in one table would erase the distinction
--    the dashboard's trust posture rests on. Hence source_kind/source_ref NOT NULL everywhere, as
--    kb_node does it.
--
-- No data. D1.3 (ingestion/build_legislative_districts.py) loads these.

-- One row per district per Congress.
--
-- district_code is a slug, not a PSGC-derived code, and that is deliberate (§1.1). The obvious
-- code -- '<province geo_code>-<ordinal>' -- asserts a parentage that is sometimes false:
-- Taguig-Pateros spans a city and a municipality, Tacloban votes with Leyte's 1st while being a
-- province-level row in dim_geo, and lone districts have no ordinal in common usage. A slug
-- asserts nothing; wikidata_qid carries machine identity where one exists.
create table dim_legislative_district (
  district_code   text primary key,            -- 'leyte-1st', 'quezon-city-3rd', 'batanes-lone'
  congress_no     smallint not null,           -- 20 = 2025-2028
  district_name   text not null,               -- as published by the source
  ordinal         smallint,                    -- null for a lone district
  is_lone         boolean not null default false,
  -- Nullable convenience, null exactly when the district spans more than one province-level geo.
  -- It is not the district's parent in any structural sense -- nothing may join through it as if
  -- dim_geo contained districts.
  parent_geo_code text references dim_geo (geo_code),
  region_code     text,                        -- convenience for filtering; null if it spans
  wikidata_qid    text,
  psa_population  integer,                     -- PSA 2020 CPH district population (validation)
  -- The dimension is time-varying: 253 districts in the 19th Congress, 254 in the 20th, and new
  -- ones are created by individual Republic Acts mid-term. congress_no is in the schema from the
  -- start (owner decision 1) so backfilling the 17th-19th later is a load, not a migration.
  valid_from      date not null,
  valid_to        date,                        -- null = current
  source_kind     text not null check (source_kind in ('wikidata','wikipedia','psa','manual','public_correction')),
  source_ref      text not null,               -- QID, or 'wikipedia:<page>@<revid>'
  retrieved_at    timestamptz not null,
  status          text not null default 'auto' check (status in ('auto','approved','rejected')),
  unique (congress_no, district_name)
);

alter table dim_legislative_district enable row level security;

-- Public read: /districts and /districts/[code] are public pages (D2.1, D2.2), and the whole
-- posture of this feature is that the mapping is published rather than asserted. Rejected rows are
-- withheld -- they are the ones a reviewer has ruled wrong, and rendering them would contradict
-- the review. 'auto' rows ARE readable: D1 loads at 'auto' and D2.1 renders all 254 immediately,
-- so gating public read on 'approved' would show an empty page after a successful ingest. The
-- match-quality badge, not the status column, is what tells a reader how much to trust a row.
create policy "dim_legislative_district public read" on dim_legislative_district
  for select
  to anon, authenticated
  using (status <> 'rejected');

-- Membership, at whatever grain the district is actually defined at: municipalities for a
-- province-level district, barangays inside a multi-district city. A parent_code column could not
-- express both, which is the second of §1's four reasons this is not a dim_geo level.
create table geo_district_map (
  id             bigint generated always as identity primary key,
  district_code  text not null references dim_legislative_district (district_code) on delete cascade,
  geo_code       text not null references dim_geo (geo_code),
  geo_level      geo_level_enum not null check (geo_level in ('citymun','barangay')),
  -- How this row's geo_code was resolved, never guessed (D1.4). Fuzzy matching a place name into
  -- a district assignment is the failure the repo's two-way reconciliation discipline exists to
  -- prevent: an unresolved LGU is a visible gap, a wrongly-matched one is a silent lie. There is
  -- deliberately no 'fuzzy' value here, so the absence is enforced rather than remembered.
  match_method   text not null check (match_method in ('exact','disambiguated','crosswalk','manual_override','public_correction')),
  source_kind    text not null,
  -- A revision id, not a URL: 'wikipedia:Legislative districts of Leyte@1234567890' is checkable
  -- years later; a bare URL is not, because the page will have changed. This is the single
  -- cheapest thing that makes the per-row receipt on /districts/[code] mean anything.
  source_ref     text not null,
  retrieved_at   timestamptz not null,
  -- Corrections supersede; nothing is overwritten. An accepted correction inserts a new row and
  -- sets superseded_by on the old one, so the history IS the audit trail and D2.2 renders it
  -- directly.
  superseded_by  bigint references geo_district_map (id),
  status         text not null default 'auto' check (status in ('auto','approved','rejected')),
  reviewed_at    timestamptz,
  reviewed_by    text,
  review_note    text
);

-- One live membership row per (district, geo): partial, because the constraint applies only to
-- rows that have not been superseded. Without the WHERE clause the supersession model above would
-- be impossible -- the correction and the row it replaces would collide.
create unique index geo_district_map_live_idx
  on geo_district_map (district_code, geo_code)
  where superseded_by is null;

-- Reverse lookup: "which district is this LGU in", which is D3.3's /api/geo/search requirement
-- ("Palo" must surface "Leyte's 1st") and one of D3.4's four regression cases. Postgres does not
-- index a foreign key automatically, and every read of this table goes in one of two directions.
create index geo_district_map_geo_code_idx on geo_district_map (geo_code);
create index geo_district_map_district_code_idx on geo_district_map (district_code);

alter table geo_district_map enable row level security;

-- Public read, superseded rows included: D2.2 publishes the per-row provenance AND the history of
-- corrections, so hiding superseded rows would hide exactly the evidence that makes the
-- correction mechanism credible rather than decorative.
create policy "geo_district_map public read" on geo_district_map
  for select
  to anon, authenticated
  using (status <> 'rejected');

-- The sitting representative, on its own clock (owner decision 4). Never a column on
-- dim_legislative_district: it is the most useful field on the page and also the one most likely
-- to be stale or contested, and giving it a separate as_of is what keeps a stale representative
-- from ageing the district row it hangs off.
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

create index district_representative_district_code_idx on district_representative (district_code);

alter table district_representative enable row level security;

create policy "district_representative public read" on district_representative
  for select
  to anon, authenticated
  using (status <> 'rejected');

-- Public correction proposals. Structured, not free text (D2.3): a proposal has to be diffable
-- against the current mapping and applyable without re-interpretation, and free text becomes a
-- triage queue nobody works.
--
-- Separate table from `feedback` because this is a structured proposal with a review lifecycle,
-- not a message -- but it reuses feedback's defences: session_id, the 2,000-char cap, and an
-- optional email that is never published.
create table district_correction (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  session_id       uuid not null,
  action           text not null check (action in ('add','remove','move','rename','other')),
  district_code    text references dim_legislative_district (district_code),
  to_district_code text,                       -- for 'move'
  geo_code         text references dim_geo (geo_code),
  rationale        text not null check (char_length(rationale) <= 2000),
  evidence_url     text,                       -- RA number, COMELEC page, PSA release
  submitter_email  text,                       -- never published; contact-back only
  status           text not null default 'open' check (status in ('open','accepted','rejected','duplicate')),
  reviewed_at      timestamptz,
  reviewed_by      text,
  -- Published verbatim on the ledger. A rejection whose reason nobody can read is
  -- indistinguishable from being ignored -- the argument 20260827120000_kb_review.sql makes about
  -- rubber-stamped approvals, pointed the other way.
  review_note      text
);

create index district_correction_status_idx on district_correction (status, created_at desc);

alter table district_correction enable row level security;

-- Public insert, and deliberately NO public select, exactly as `feedback` does it: submitter_email
-- sits on this table, and a SELECT policy broad enough to serve D2.5's public ledger would also
-- serve anyone who wants the email column. The ledger therefore reads through a server-side route
-- that projects the publishable columns only; that is D2.5's job, not this migration's.
--
-- Note for whoever writes the insert path: Postgres re-checks RETURNING rows against the table's
-- SELECT policies, so inserting with `Prefer: return=representation` (Supabase JS:
-- `.insert(...).select()`) fails here with the same generic RLS error as a real WITH CHECK
-- failure. Use `.insert(...)` alone. This cost a debugging session on `feedback` already --
-- see docs/DECISIONS.md, increment 0.3.
create policy "district_correction public insert" on district_correction
  for insert
  to anon, authenticated
  with check (true);
