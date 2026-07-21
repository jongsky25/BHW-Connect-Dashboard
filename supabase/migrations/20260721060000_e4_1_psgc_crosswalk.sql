-- E4.1 PSGC crosswalk (docs/EXPLORE_ENHANCEMENT_PLAN.md §E4.1 — "do first, infrastructure").
--
-- Purpose: dim_geo is fixed on one PSGC vintage ('2023 series (>=2024 release, includes
-- NIR)'). Every later external load (POPCEN/CPH, SAE poverty, DOF/BLGF income classes, …)
-- arrives keyed on *its own* PSGC vintage, and a code that was renumbered/reassigned
-- between vintages would silently fall out of a naive join. dim_psgc_crosswalk maps a
-- source-vintage code (old_code) onto dim_geo's current code (new_code) so those loads can
-- resolve their codes first, and the map_psgc_to_dim_geo() helper is the single primitive
-- they call. Unmatched codes are the reconciliation output every load commits to docs/
-- (the 1.6 boundary-reconciliation discipline), never a silent drop.
--
-- Seed contents: the one large, *verifiable* PSGC vintage change this repo already carries
-- hard evidence for — the Negros Island Region (NIR / Region XVIII) re-establishment by
-- RA 12000 (2024). Pre-NIR PSGC filed Negros Occidental under Region VI (06) and Negros
-- Oriental + Siquijor under Region VII (07); dim_geo (post-NIR) files all three under
-- Region 18 with re-prefixed codes. The mapping is derived directly FROM dim_geo (the join
-- target of truth), not from any external file — for every geo under the three NIR
-- provinces, old_code is the same code with its region prefix swapped back (18→06 / 18→07),
-- the exact remapping already applied in ingestion/reconcile_boundaries.py
-- (NIR_PROVINCE_CROSSWALK). 1,357 rows: 3 provinces + 62 citymuns + 1,292 barangays.
--
-- The general quarterly-file path (diffing two PSA PSGC publication snapshots into
-- additional change rows) lives in ingestion/build_psgc_crosswalk.py; the PSA site is
-- Cloudflare bot-challenged from this environment (the plan's flagged constraint), so that
-- path is documented + runnable but not fed here. dim_dataset.status stays 'draft' until a
-- real quarterly file is diffed in. Full write-up: docs/PSGC_CROSSWALK.md.
--
-- Applied live via the Supabase MCP; idempotent (re-runnable). See docs/DECISIONS.md.

create table if not exists dim_psgc_crosswalk (
  crosswalk_id bigint generated always as identity primary key,
  old_code text not null,                       -- code as it appears in the source vintage
  new_code text references dim_geo (geo_code),   -- current dim_geo code (NULL = abolished, no successor)
  geo_level geo_level_enum not null,
  old_vintage text not null,                     -- vintage old_code belongs to
  new_vintage text not null,                     -- vintage new_code belongs to (matches dim_geo.psgc_vintage)
  change_kind text not null check (change_kind in (
    'region_reassignment', -- geo moved to a different parent region; code re-prefixed (e.g. NIR)
    'renamed',             -- same code, new name
    'renumbered',          -- new code, same place
    'created',             -- new geo with no prior code
    'abolished',           -- geo removed (new_code NULL, or the code it merged into)
    'merged',              -- folded into another geo
    'split',               -- one geo became several (one row per successor)
    'reclassified',        -- level/class change (e.g. municipality -> city) keeping identity
    'converted'            -- LGU conversion (e.g. component city -> HUC)
  )),
  old_name text,
  new_name text,
  note text,
  dataset_id bigint references dim_dataset (dataset_id),
  -- One target per source code per vintage pair, so map_psgc_to_dim_geo() is deterministic.
  -- A genuine 1:many split would need explicit downstream disambiguation — none is seeded.
  unique (old_code, old_vintage, new_vintage)
);

create index if not exists dim_psgc_crosswalk_old_code_idx on dim_psgc_crosswalk (old_code);
create index if not exists dim_psgc_crosswalk_new_code_idx on dim_psgc_crosswalk (new_code);

comment on table dim_psgc_crosswalk is
  'Maps a source-vintage PSGC code (old_code) onto dim_geo''s current code (new_code) so external loads on other PSGC vintages join without silent loss. E4.1 infrastructure; see docs/PSGC_CROSSWALK.md.';

alter table dim_psgc_crosswalk enable row level security;

drop policy if exists "dim_psgc_crosswalk public read" on dim_psgc_crosswalk;
create policy "dim_psgc_crosswalk public read" on dim_psgc_crosswalk
  for select
  to anon, authenticated
  using (true);

-- Resolution primitive every later load calls: current code passes through, a source-vintage
-- code resolves via the crosswalk, an unresolvable code returns NULL (caller logs it — the
-- two-way reconciliation discipline). Direct-hit is checked first; the seeded old codes are
-- verified not to collide with any live dim_geo code, so a stale code never short-circuits.
create or replace function map_psgc_to_dim_geo(
  p_code text,
  p_old_vintage text default null
) returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select g.geo_code from dim_geo g where g.geo_code = p_code),
    (select x.new_code
       from dim_psgc_crosswalk x
      where x.old_code = p_code
        and (p_old_vintage is null or x.old_vintage = p_old_vintage)
      order by x.new_vintage desc
      limit 1)
  );
$$;

grant execute on function map_psgc_to_dim_geo(text, text) to anon, authenticated;

-- Provenance row for the crosswalk source. 'draft' until a real PSA quarterly file is
-- diffed in (the seeded NIR block is derived from dim_geo + RA 12000, not the file yet).
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'psa-psgc-crosswalk',
  'PSA PSGC vintage crosswalk',
  'Philippine Statistics Authority — Philippine Standard Geographic Code (PSGC) quarterly publication',
  'https://psa.gov.ph/classification/psgc',
  'PSA open data terms (attribution)',
  null,
  '2024-06-13',  -- RA 12000 effectivity, anchoring the seeded NIR change; refresh on a real file diff
  '1.0',
  'draft'
)
on conflict (slug) do nothing;

-- Seed: NIR (RA 12000, 2024) region re-prefix. Idempotent — clear this vintage-pair first.
delete from dim_psgc_crosswalk
 where old_vintage = 'pre-NIR (PSGC before RA 12000, 2024)'
   and new_vintage = '2023 series (>=2024 release, includes NIR)';

insert into dim_psgc_crosswalk (
  old_code, new_code, geo_level, old_vintage, new_vintage, change_kind, old_name, new_name, note, dataset_id
)
select
  -- Region-prefix swap back to the pre-NIR region, province digits preserved.
  case g.province_code
    when '18045' then '06'    -- Negros Occidental -> Region VI (Western Visayas)
    when '18046' then '07'    -- Negros Oriental  -> Region VII (Central Visayas)
    when '18061' then '07'    -- Siquijor         -> Region VII (Central Visayas)
  end || substr(g.geo_code, 3)                      as old_code,
  g.geo_code                                        as new_code,
  g.geo_level,
  'pre-NIR (PSGC before RA 12000, 2024)'            as old_vintage,
  '2023 series (>=2024 release, includes NIR)'      as new_vintage,
  'region_reassignment'                             as change_kind,
  g.geo_name                                        as old_name,   -- names unchanged by NIR
  g.geo_name                                        as new_name,
  'NIR (RA 12000, 2024): region prefix re-assigned; place + name unchanged.' as note,
  (select dataset_id from dim_dataset where slug = 'psa-psgc-crosswalk') as dataset_id
from dim_geo g
where g.province_code in ('18045', '18046', '18061');
