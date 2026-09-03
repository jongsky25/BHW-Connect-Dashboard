-- Register the three legislative district relations (docs/LEGISLATIVE_DISTRICTS_PLAN.md §4 D1.6).
--
-- The rows below are lifted verbatim from the canonical seed,
-- supabase/migrations/20260826090100_seed_dataset_registry.sql, which stays the single source for
-- what the registry says — this file only carries the delta to the live project, on the same
-- pattern as U5's, U7's, U9's, U10's and U12b's registry applies.
-- `lib/db/dataset-registry-seed.test.ts` guards the canonical file, so the two cannot drift
-- without a test failing.
--
-- district_correction is deliberately NOT registered here. It is D2.3's correction-submission
-- queue: it has no rows, no settled semantics, and a submitter_email column. Registering a table
-- is what makes queryDataset willing to read it, so an unused table carrying an email address is
-- precisely the one not to open ahead of the feature that fills it. It gets its entry when D2.3
-- ships and can say what its columns mean.
--
-- What these notes are for, and why they are blunt. queryDataset refuses any relation without an
-- approved dictionary, so this text is what a model reads before composing a query about who
-- votes where. Three things in it would otherwise be got wrong in a way no downstream check would
-- catch: that the mapping is derived rather than official, that every row rests on a single
-- source, and that an absent LGU means "no answer" rather than "no district".

insert into dataset_registry (
  table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
  source_kind, status, notes_md, doc_path
) values
  ('dim_legislative_district',
   'Legislative districts of the 20th Congress',
   'One congressional district of the 20th Congress of the Philippines: its slug, the province or city it belongs to, its Wikidata identity, and the district population its source article publishes.',
   'One legislative district per Congress.',
   'ph-legislative-districts', 'public', 250, 'hand_written', 'approved',
   'DERIVED FROM PUBLIC SOURCES, NOT PUBLISHED BY PSA OR COMELEC, AND RESTING ON ONE SOURCE. Say so whenever these rows are quoted. psa_population IS NOT A ROLL-UP OF THE MEMBER LGUs AND MUST NEVER BE PRESENTED AS ONE: it is the figure the district''s own Wikipedia infobox prints, which is why it can be compared against the summed member populations as an independent check - 161 of the 168 testable districts sum exactly. Five known districts disagree because the infobox figure is stale relative to the LGU list printed beside it (Pampanga''s 2nd is 141,932 short, almost all of it Porac); those are named with their evidence in docs/LEGISLATIVE_DISTRICTS.md and are NOT misassignments. Read psa_population_year alongside it - it is not stored here, it lives in the QA report, and the articles quote different censuses (195 say 2020, 34 say 2015, 21 say 2024), so a figure is only comparable within its own vintage. 250 rows against 256 labels in the Wikidata roster: six labels are not enumerated by any parsed article and are reported as a registry disagreement rather than invented. Several of the six are superseded by redistricting (Maguindanao''s two, since split into del Norte and del Sur; Agusan del Norte''s two, since merged at-large; Pampanga at-large), so the gap is not six missing seats - but which are historical and which are genuinely absent has not been established row by row, and this table does not claim it has. ordinal is null exactly when is_lone is true. parent_geo_code is a province OR a city - PSGC files a highly urbanised city under its own province-level row, so a lone-district HUC points at a citymun code.',
   'docs/LEGISLATIVE_DISTRICTS.md'),
  ('geo_district_map',
   'Which city, municipality or barangay is in which legislative district',
   'The mapping itself: one row per place assigned to a district, at city/municipality grain for a whole-LGU district and at barangay grain for a city split across several. Each row carries the rule that placed it, the page and revision it was read from, and whether any second source has corroborated it.',
   'One geography per district.',
   'ph-legislative-districts', 'public', 3513, 'hand_written', 'approved',
   'EVERY ROW IS single_source AND THAT IS A PUBLISHED FACT, NOT AN OVERSIGHT. The project rule was that no district assignment ships on two sources; COMELEC''s precinct returns were the intended second one and are unreachable (HTTP 403 everywhere, no Wayback capture), so the mapping ships on one and the public correction pipeline becomes the second opinion, arriving after publication. Never describe a row as verified. ABSENCE MEANS NO ANSWER, NEVER NO DISTRICT. This table is INCOMPLETE by design rather than by accident: 1,628 of 1,651 cities and municipalities are covered, and the missing 23 include the eight BARMM Special Geographic Area municipalities and Paco, one of Manila''s ten administrative districts. 41 barangays across 12 multi-district cities are also unplaced. A place with no row here was not resolvable by a stated rule and was left out rather than matched approximately - there is deliberately no fuzzy name-matching rung in the ladder. MIXED GRAIN IN ONE TABLE: geo_level is citymun for 1,604 rows and barangay for 1,909, so counting rows is never counting places of one kind, and a city split across districts is present ONLY through its barangays, never as itself. match_method is how the row was resolved and is the first thing to read before trusting one. No place is claimed by two districts; that is asserted at load and re-checked live.',
   'docs/LEGISLATIVE_DISTRICTS.md'),
  ('district_representative',
   'Sitting representative per district',
   'The member of the House of Representatives sitting for each district, as the source article named them on the retrieval date, with their party where the article gave one.',
   'One representative per district per Congress.',
   'ph-legislative-districts', 'public', 194, 'hand_written', 'approved',
   'DERIVED FROM A PUBLIC SOURCE, ON ONE SOURCE, AND A SNAPSHOT OF WHAT A WIKI PAGE SAID RATHER THAN A ROSTER FROM THE HOUSE. Names are as printed and are not reconciled against any official list, so spelling, nicknames and honorifics vary by article. 194 rows against 250 districts: a district with no row is one whose article did not name a sitting member at the retrieval date, NOT a vacant seat - never report an absence here as a vacancy. party is null on every row in the current load; the province tables carry party in a template this build does not parse, so null means not extracted rather than independent. as_of is the 20th Congress term start, the same date for every row, and is not the date the person took office.',
   'docs/LEGISLATIVE_DISTRICTS.md')
on conflict (table_name) do update set
  title = excluded.title,
  summary = excluded.summary,
  grain = excluded.grain,
  dataset_slug = excluded.dataset_slug,
  exposure = excluded.exposure,
  row_estimate = excluded.row_estimate,
  source_kind = excluded.source_kind,
  status = excluded.status,
  notes_md = excluded.notes_md,
  doc_path = excluded.doc_path,
  updated_at = now();

insert into dataset_column (
  registry_id, column_name, ordinal, data_type, allowed_values,
  meaning, unit, role, is_join_key, joins_to, is_queryable, status
)
select
  r.registry_id, c.column_name, c.ordinal, c.data_type,
  case when c.allowed_values is null then null else string_to_array(c.allowed_values, '|') end,
  c.meaning, c.unit, c.role, c.is_join_key, c.joins_to, c.is_queryable, 'approved'
from (values
  -- dim_legislative_district
  ('dim_legislative_district','district_code',1,'text',null,'Stable slug identifying the district, such as pampanga-2nd or abra-at-large. The key every other district table joins on.',null,'key',true,'dim_legislative_district.district_code',true),
  ('dim_legislative_district','congress_no',2,'smallint',null,'Which Congress this district composition belongs to. Every row currently loaded is 20 - always filter on it anyway, because a later Congress will add rows beside these rather than replace them.',null,'dimension',false,null,true),
  ('dim_legislative_district','district_name',3,'text',null,'The district''s name as its source article gives it, such as "Pampanga''s 2nd congressional district". Not always derivable from district_code: two districts carry a name whose wording differs from the slug.',null,'dimension',false,null,true),
  ('dim_legislative_district','ordinal',4,'smallint',null,'Which numbered district this is within its province or city (1st, 2nd, ...). NULL exactly when is_lone is true; there is no ordinal 0 and no ordinal for an at-large seat.',null,'dimension',false,null,true),
  ('dim_legislative_district','is_lone',5,'boolean',null,'True when the province or city elects a single representative at large, so the district and the whole LGU are the same area.',null,'dimension',false,null,true),
  ('dim_legislative_district','parent_geo_code',6,'text',null,'The province OR city this district sits in. A PROVINCE CODE FOR MOST ROWS AND A CITY CODE FOR OTHERS: PSGC files a highly urbanised city under its own province-level row, so a lone-district HUC such as Baguio points at a citymun code. Null on the two Taguig-Pateros rows, whose area spans two PSGC parents.',null,'key',true,'dim_geo.geo_code',true),
  ('dim_legislative_district','region_code',7,'text',null,'Region the district sits in, denormalized for filtering. Null on 3 of 250 rows where the source did not establish one (Calamba and the two Taguig-Pateros districts), so a region filter drops those three rather than mis-filing them.',null,'key',true,'dim_geo.geo_code',true),
  ('dim_legislative_district','wikidata_qid',8,'text',null,'Wikidata item for the district, used to cross-check that the parsed roster and the Wikidata roster name the same set of districts.',null,'meta',false,null,true),
  ('dim_legislative_district','psa_population',9,'integer',null,'The district population its own source article publishes. NOT A ROLL-UP OF THE MEMBER LGUs AND NEVER TO BE PRESENTED AS ONE - it is an independently published figure, which is exactly what makes it usable as a check against the summed members. THE CENSUS YEAR IS NOT STORED IN THIS TABLE and the articles quote different ones (195 say 2020, 34 say 2015, 21 say 2024), so two districts'' figures are not comparable to each other without it; the per-district year is in the QA report and docs/LEGISLATIVE_DISTRICTS.md. Five districts carry a figure that is stale against the LGU list printed beside it in the same article.','count','measure',false,null,true),
  ('dim_legislative_district','valid_from',10,'date',null,'First day this district composition applies - the 20th Congress term start on every current row.',null,'dimension',false,null,true),
  ('dim_legislative_district','valid_to',11,'date',null,'Last day this composition applies; null while current. Null on every current row.',null,'dimension',false,null,true),
  ('dim_legislative_district','source_kind',12,'text','wikidata|wikipedia|psa|manual|public_correction','What kind of source this row came from. wikipedia on every current row.',null,'dimension',false,null,true),
  ('dim_legislative_district','source_ref',13,'text',null,'The exact source, as page title and revision id: wikipedia:<article title>@<revid>. This is the row''s receipt - it names a version of a page that can still be opened and read.',null,'meta',false,null,true),
  ('dim_legislative_district','retrieved_at',14,'timestamptz',null,'When the source page was fetched. Distinct from as_of_date and valid_from, which are term boundaries rather than retrieval times.',null,'meta',false,null,true),
  ('dim_legislative_district','status',15,'text','auto|approved|rejected','Review state. auto means machine-derived and not yet reviewed by a person, which is every current row; rejected rows are hidden from public reads by the row-level policy.',null,'dimension',false,null,true),
  -- geo_district_map
  ('geo_district_map','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('geo_district_map','district_code',2,'text',null,'The district this place is assigned to.',null,'key',true,'dim_legislative_district.district_code',true),
  ('geo_district_map','geo_code',3,'text',null,'The place assigned. A city/municipality code OR a barangay code - read geo_level before joining or counting.',null,'key',true,'dim_geo.geo_code',true),
  ('geo_district_map','geo_level',4,'geo_level_enum','citymun|barangay','Grain of this row. citymun on 1,604 rows where a whole LGU sits in one district; barangay on 1,909 rows where a city is split across districts. A SPLIT CITY IS PRESENT ONLY THROUGH ITS BARANGAYS AND NEVER AS ITSELF, so a citymun-only filter silently drops every multi-district city.',null,'dimension',false,null,true),
  ('geo_district_map','match_method',5,'text','exact|disambiguated|crosswalk|manual_override|public_correction|whole_parent|independent_city|whole_citymun|psgc_identifier|barangay_roster','THE RULE THAT PLACED THIS ROW, and the first thing to read before trusting one. exact: the source named this place and the name resolved to exactly one dim_geo row. whole_parent: the district covers a whole province, so every LGU in it was expanded. whole_citymun: a caption named a city and the source did not enumerate its barangays. independent_city: a city outside the province that votes with it, read from the article''s lead sentence. psgc_identifier: the article printed a PSGC code. barangay_roster: the article''s barangay list matched a dim_geo city''s roster, used where a place had been renamed. manual_override: a documented hand decision. THERE IS NO FUZZY NAME-MATCHING VALUE AND THAT IS DELIBERATE - a place that resolved to nothing was left out, not approximated.',null,'dimension',false,null,true),
  ('geo_district_map','source_kind',6,'text','wikidata|wikipedia|psa|manual|public_correction','What kind of source placed this row. wikipedia on every current row.',null,'dimension',false,null,true),
  ('geo_district_map','source_ref',7,'text',null,'The exact source, as page title and revision id. 80 rows cite a per-city barangay list rather than the district''s own article, so this is NOT always the same string as the district''s source_ref.',null,'meta',false,null,true),
  ('geo_district_map','retrieved_at',8,'timestamptz',null,'When the source page was fetched.',null,'meta',false,null,true),
  ('geo_district_map','superseded_by',9,'bigint',null,'Row id that replaced this one when a correction was accepted; null while current.',null,'meta',false,null,false),
  ('geo_district_map','status',10,'text','auto|approved|rejected','Review state. auto means machine-derived and not yet reviewed by a person, which is every current row; rejected rows are hidden from public reads.',null,'dimension',false,null,true),
  ('geo_district_map','reviewed_at',11,'timestamptz',null,'When a person reviewed this row; null on every current row.',null,'meta',false,null,false),
  ('geo_district_map','reviewed_by',12,'text',null,'Who reviewed this row; null on every current row.',null,'meta',false,null,false),
  ('geo_district_map','review_note',13,'text',null,'Why a reviewer accepted or rejected this row; null on every current row.',null,'meta',false,null,false),
  ('geo_district_map','corroboration',14,'text','single_source|corroborated|conflict','Whether a second source has confirmed this assignment. single_source ON ALL 3,513 CURRENT ROWS - never describe one as verified. The intended second source, COMELEC''s precinct returns, is unreachable, so corroboration now arrives after publication through the public correction pipeline. A conflict row is one a second source contradicted and is withheld from the load entirely rather than shipped with a flag.',null,'dimension',false,null,true),
  ('geo_district_map','corroborating_source_ref',15,'text',null,'The second source that confirmed this row, where one did; null on every current row.',null,'meta',false,null,true),
  -- district_representative
  ('district_representative','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('district_representative','district_code',2,'text',null,'The district this person sits for.',null,'key',true,'dim_legislative_district.district_code',true),
  ('district_representative','congress_no',3,'smallint',null,'Which Congress. 20 on every current row.',null,'dimension',false,null,true),
  ('district_representative','full_name',4,'text',null,'The representative''s name AS THE SOURCE ARTICLE PRINTED IT - not reconciled against any official roster, so honorifics, nicknames, middle initials and suffixes vary between rows. Do not treat it as a canonical identifier and do not match people across datasets on it.',null,'dimension',false,null,true),
  ('district_representative','party',5,'text',null,'Political party. NULL ON EVERY CURRENT ROW: the source tables carry party inside a template this build does not parse, so null means not extracted, never independent or unaffiliated.',null,'dimension',false,null,true),
  ('district_representative','as_of',6,'date',null,'The date this naming applies from - the 20th Congress term start on every row. NOT the date the person took office and not the retrieval date.',null,'dimension',false,null,true),
  ('district_representative','source_kind',7,'text','wikidata|wikipedia|psa|manual|public_correction','What kind of source named this person. wikipedia on every current row.',null,'dimension',false,null,true),
  ('district_representative','source_ref',8,'text',null,'The exact source, as page title and revision id. Usually the province-level article rather than the district''s own.',null,'meta',false,null,true),
  ('district_representative','superseded_by',9,'bigint',null,'Row id that replaced this one; null while current.',null,'meta',false,null,false),
  ('district_representative','status',10,'text','auto|approved|rejected','Review state. auto on every current row; rejected rows are hidden from public reads.',null,'dimension',false,null,true)
) as c (
  table_name, column_name, ordinal, data_type, allowed_values,
  meaning, unit, role, is_join_key, joins_to, is_queryable
)
join dataset_registry r on r.table_name = c.table_name
on conflict (registry_id, column_name) do update set
  ordinal = excluded.ordinal,
  data_type = excluded.data_type,
  allowed_values = excluded.allowed_values,
  meaning = excluded.meaning,
  unit = excluded.unit,
  role = excluded.role,
  is_join_key = excluded.is_join_key,
  joins_to = excluded.joins_to,
  is_queryable = excluded.is_queryable,
  status = excluded.status;
