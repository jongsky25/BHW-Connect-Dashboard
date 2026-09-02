-- Legislative districts, Increment D1.3e: a district described by sub-city administrative unit.
--
-- WHAT THIS FIXES. Manila was 258 of its 857 barangays mapped, and the shortfall was invisible:
-- the citymun-coverage gate reported it as "9 uncovered rows", which reads like nine small gaps
-- rather than four legislative districts holding no members at all.
--
-- Manila is described at two grains and the resolver only handled one. Its 1st and 2nd districts
-- enumerate numbered barangays ("Barangay 1" ... "Barangay 267"), which resolve -- and which all
-- sit in Tondo, hence the 258. Its 3rd to 6th name ADMINISTRATIVE DISTRICTS instead: "Binondo",
-- "Quiapo", "San Nicolas", "Santa Cruz", "Sampaloc", "Malate", "Port Area", "Pandacan",
-- "Santa Ana". Those are not barangays, so a barangay-scoped lookup returned
-- `unresolved_barangay` for every one of them and those four districts produced no rows.
--
-- Unlike Davao City -- whose 3rd district is described the same way but whose administrative
-- districts PSGC does not model at any level -- Manila's ARE dim_geo rows. Manila's province-level
-- row (13806) has ten citymun children which are precisely those administrative districts, the
-- only place PSGC uses a sub-city level at all. So nothing is expanded or inferred here: the
-- source name matches exactly one citymun already inside the page's own scope, and the row is
-- emitted at that grain. That is what the plan's §3 means by membership "at whatever grain the
-- district is actually defined at", and geo_level on the row is what records which grain it was.
--
-- WHY IT IS ITS OWN METHOD AND NOT `exact`.
--
-- Same argument as `independent_city` in 20260902070000, applied one level down: the set the name
-- was matched against changed -- the scope's citymun children rather than its barangays -- and
-- that is a property of the row, not of a build log. A reader of /districts/[code] seeing one
-- citymun row beside a sibling district's 146 barangay rows is owed the reason, and "we matched
-- the whole of Sampaloc by name" is a different claim from "we matched this barangay by name",
-- with a different way of being wrong.
--
-- THE CAPTION RULE, recorded because it is the part that could have gone silently wrong.
-- Manila's 1st writes its towns field as "Tondo" followed by barangays 1-146, and the 2nd as
-- "Tondo" followed by 147-267. "Tondo" there is a heading over the list, not a member. Read as a
-- member it would hand each district the whole of Tondo and double-claim all 259 barangays -- the
-- same double-count trap D1.1 found in BetterGov's districts.json. So a citymun whose barangays
-- the district already enumerates is treated as the caption it is. Against today's dim_geo the
-- guard is belt-and-braces ("Tondo" does not normalise onto "TONDO I/II"), which is exactly why
-- it is asserted in --selftest rather than left to depend on a spelling.
--
-- WHAT REMAINS, and is deliberately not forced: Paco is listed by BOTH the 5th and the 6th
-- districts. Claiming it for either would invent a fact, and claiming it for both would
-- double-count, so the collision guard reports it and neither district gets it -- 43 barangays
-- that COMELEC precinct returns resolve exactly and Wikipedia cannot.
alter table geo_district_map drop constraint geo_district_map_match_method_check;
alter table geo_district_map
  add constraint geo_district_map_match_method_check
  check (match_method in ('exact', 'disambiguated', 'crosswalk', 'manual_override',
                          'public_correction', 'whole_parent', 'independent_city',
                          'whole_citymun'));

comment on column geo_district_map.match_method is
  'How this row was resolved. There is deliberately no fuzzy value: guardrail 1 says an '
  'unresolved LGU is a published finding and a wrongly-matched one is an invisible lie, so the '
  'absence is enforced by this constraint rather than remembered by an implementer. '
  'independent_city = matched exactly, against a province scope widened to include an independent '
  'city that the province page''s own lead sentence says its districts represent. '
  'whole_citymun = the district names a whole sub-city administrative unit that PSGC models as a '
  'citymun (Manila''s "Sampaloc", "Santa Cruz"), matched within that city''s own scope.';
