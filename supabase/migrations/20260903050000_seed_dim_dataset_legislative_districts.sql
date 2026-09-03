-- Register the legislative district mapping as a dataset (docs/LEGISLATIVE_DISTRICTS_PLAN.md
-- §4 D1.6).
--
-- The rows have been in the database since D1.6a; until this file they were data with no
-- passport. `dim_dataset` is what versions the AI assistant's caches (§6.4), what `/districts`
-- reads its attribution line from (§8), and what tells anyone querying `geo_district_map` where
-- 3,513 assertions about who votes where actually came from.
--
-- LICENCE, and why it is worded the way it is. §8 settles this: the mapping is a set of *facts*
-- (which municipality is in which district) assembled from Wikipedia's CC BY-SA 4.0 text. Facts
-- are not copyrightable, so publishing the derived mapping under the repo's CC BY 4.0 commitment
-- is defensible — but the field names the source licence anyway rather than printing our own,
-- because a reader checking whether they may redistribute this needs the upstream term, not our
-- conclusion about it. Per-row attribution is stronger still and already exists: every
-- geo_district_map row carries the page title and revision id it was read from.
--
-- source_url is the index page rather than any single article, because there is no single
-- article: the build reads 114 province-level pages plus per-district and per-city articles, and
-- the honest link is the one a reader can navigate from. The specific revisions are per row.
--
-- as_of_date '2025-06-30' is the 20th Congress's term start, which is also the valid_from every
-- dim_legislative_district row carries. It is a term boundary, not a retrieval date — the
-- retrieval date lives per row in retrieved_at, and the two differ by more than a year.
--
-- status 'published': the rows are live and publicly readable. Not 'active' — that value is
-- reserved for the single per-person BHW dataset (see the dim_dataset registry entry).
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status,
  methodology_md
) values (
  'ph-legislative-districts',
  'Philippine legislative districts (20th Congress)',
  'English Wikipedia — the per-province "Legislative districts of X" articles, the per-district articles, and the per-city barangay lists, each read at a named revision; district identity cross-checked against Wikidata',
  'https://en.wikipedia.org/wiki/Legislative_districts_of_the_Philippines',
  'Source text CC BY-SA 4.0 (English Wikipedia). The mapping published here is the derived set of facts, attributed per row by page title and revision id.',
  'barangay',
  '2025-06-30',
  '1.0',
  'published',
  'This mapping is **derived from public sources. It is not published by PSA or COMELEC**, and no government body has certified it.

**One source, not two.** The project''s own rule was that no district assignment ships on a single source. That rule assumed a second source could be obtained. COMELEC''s House-contest precinct returns were the intended second opinion and they are gone — every endpoint answers HTTP 403, and the Wayback Machine holds no capture of them. Rather than publish nothing, the mapping ships single-source, and every row says so: `geo_district_map.corroboration` reads `single_source` on all 3,513 of them. The second source is now the public correction pipeline — corroboration that arrives after publication, from the people the rows are about. That is weaker than a second authority checked beforehand and is not offered as equivalent.

**How a row was resolved is recorded, and there is no fuzzy rung.** `match_method` names the rule that placed each LGU: an exact name match, a whole-province or whole-city expansion, an independent city read from an article''s lead sentence, a PSGC code printed in an article, or a barangay roster compared against dim_geo. A place whose name could not be resolved by one of those rules is **left out and listed as unresolved** rather than matched approximately. A published gap is a finding; a wrong match is an invisible error.

**It is incomplete, and the gaps are named.** 1,628 of 1,651 cities and municipalities are covered. The 23 that are not include the eight municipalities of the BARMM Special Geographic Area, created after the source articles were written, and Paco — one of Manila''s ten administrative districts, which PSGC models as a city/municipality and no district article enumerates. 41 barangays across 12 multi-district cities are likewise unplaced. Absence here means "no answer", never "no district".

**Cross-checked, on composition.** An independent COMELEC-derived mapping agrees with 2,229 of the assignments it covers and disagrees with none. District member populations were reconciled against PSA census totals: 161 of 168 testable districts sum exactly, and every non-zero difference is published with the reason it is not a misassignment.

The full build report, including every gate and every gap, is `docs/LEGISLATIVE_DISTRICTS.md`.'
)
on conflict (slug) do update set
  name = excluded.name,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  license = excluded.license,
  geo_join_level = excluded.geo_join_level,
  as_of_date = excluded.as_of_date,
  version = excluded.version,
  status = excluded.status,
  methodology_md = excluded.methodology_md,
  last_updated_at = now();
