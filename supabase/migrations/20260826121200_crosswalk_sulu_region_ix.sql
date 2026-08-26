-- Sulu's move from BARMM (region 19) to Region IX (09) — dim_psgc_crosswalk rows.
--
-- Why this exists: the UUC for PHC 2025 workbook files Sulu's barangays under Region IX with
-- '09066…' codes, following Sulu's 2024 removal from BARMM. dim_geo is fixed on the '2023
-- series (>=2024 release, includes NIR)' vintage, which still holds Sulu as '19066…' under
-- region 19. 87 of the list's 5,991 barangays carry the '09066' prefix and resolve against
-- dim_geo through nothing else.
--
-- Note the direction: for every other crosswalk row seeded so far the source vintage is OLDER
-- than dim_geo's. Here it is NEWER — the workbook and the 2027 Budget Cue Cards agree with each
-- other on Region IX (p37's Region IX count of 523 includes Sulu), and the dashboard's geography
-- is the side on the older vintage. The column semantics still hold: old_code is "the code as it
-- appears in the source vintage", new_code is "dim_geo's current code" (see the table comment on
-- dim_psgc_crosswalk), so old_code is the '09066…' form regardless of which is chronologically
-- older.
--
-- Crosswalk rows, NOT a dim_geo edit — the discipline set by docs/PSGC_CROSSWALK.md and named in
-- docs/AI_ASSISTANT_PLAN.md §3 as the model for later entity-resolution problems. Editing dim_geo
-- instead would retroactively move every existing BHW figure for Sulu between regions, silently
-- rewriting published numbers for a dataset that has nothing to do with this one.
--
-- Derived FROM dim_geo, the join target of truth, exactly as the NIR seed was: every Sulu geo is
-- mapped by swapping its region prefix (19 -> 09), which is the whole of the change. All 430 Sulu
-- geos are seeded (1 province + 19 city/municipalities + 410 barangays), not just the 87 barangays
-- this dataset needs — the map describes the vintage difference, and the next load arriving on the
-- same vintage should not have to re-seed it. Verified: no '09066…' code exists in dim_geo at any
-- level, so map_psgc_to_dim_geo()'s direct-hit branch cannot short-circuit these.
--
-- Idempotent: clears this vintage pair first, then re-derives.

delete from dim_psgc_crosswalk
 where old_vintage = 'post-2024 Sulu transfer (Sulu under Region IX)'
   and new_vintage = '2023 series (>=2024 release, includes NIR)';

insert into dim_psgc_crosswalk (
  old_code, new_code, geo_level, old_vintage, new_vintage, change_kind, old_name, new_name, note,
  dataset_id
)
select
  '09' || substr(g.geo_code, 3),
  g.geo_code,
  g.geo_level,
  'post-2024 Sulu transfer (Sulu under Region IX)',
  '2023 series (>=2024 release, includes NIR)',
  'region_reassignment',
  g.geo_name,
  g.geo_name,
  'Sulu filed under Region IX (09) in the source; dim_geo holds it under BARMM (19). Region '
    || 'prefix only — province, city/municipality and barangay digits are unchanged.',
  (select dataset_id from dim_dataset where slug = 'psa-psgc-crosswalk')
from dim_geo g
where g.geo_code like '19066%'   -- province 19066 (Sulu) and everything beneath it
on conflict (old_code, old_vintage, new_vintage) do nothing;
