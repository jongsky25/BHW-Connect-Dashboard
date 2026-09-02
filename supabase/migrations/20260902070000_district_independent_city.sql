-- Legislative districts, Increment D1.3d: a fifth way a membership row can be resolved.
--
-- WHAT THIS FIXES, because the number it moves is small and the reason is not.
--
-- Six municipalities were uncovered with no source defect behind them: Angeles, Olongapo, Lucena,
-- Tacloban, Puerto Princesa and Isabela City. The earlier reading of this gap -- that Wikidata's
-- district roster was missing six lone districts -- was wrong. None of these cities has a district
-- of its own. Each is a *member* of an existing district, named plainly in that district's own
-- Wikipedia article: Angeles in Pampanga's 1st, Olongapo in Zambales's 1st, Lucena in Quezon's
-- 2nd, Tacloban in Leyte's 1st, Puerto Princesa in Palawan's 3rd, Isabela City in Basilan's lone.
-- An independently derived COMELEC-based mapping agrees with all six.
--
-- The failure was ours, one level down, and it is a fact about PSGC rather than about Wikipedia:
-- a highly urbanised city gets its OWN province-level row in dim_geo, with the city hanging off
-- that row -- 'CITY OF ANGELES (HUC)' (03301) with child 'CITY OF ANGELES' (0330100), beside but
-- not inside PAMPANGA. A city may still vote with the province it sits in. So a province-scoped
-- lookup, which is the correct default and stays the default, cannot reach a row that is not the
-- province's child, and all five came back `unresolved_in_province` while the source said exactly
-- where they belonged.
--
-- WHY IT IS ITS OWN METHOD AND NOT `exact`.
--
-- The set the name was matched against was widened, and a reader of /districts/[code] is owed
-- that. D1.3b's third bug -- a barangay of Taguig matching the municipality of San Roque in
-- Northern Samar -- looked like a clean `exact` match precisely because a widened lookup left no
-- trace on the row. The widening here is narrow and attested: it comes from the province page's
-- own lead sentence ("...the province of [[Pampanga]] and the highly urbanized city of [[Angeles
-- City|Angeles]]..."), and the candidate must resolve to exactly one citymun in the province's
-- REGION. But "attested and narrow" is a property of how the row was made, and the whole point of
-- match_method is that such properties live on the row rather than in a build log.
--
-- Isabela City is deliberately NOT this method. It votes with Basilan from Region IX while the
-- rest of Basilan is in the Bangsamoro, so the region test refuses it and Basilan's page lead
-- names no city at all. A person decided it, with a reason recorded in the builder, and it ships
-- as `manual_override` -- the rung the plan's D1.4 named for it in advance.
alter table geo_district_map drop constraint geo_district_map_match_method_check;
alter table geo_district_map
  add constraint geo_district_map_match_method_check
  check (match_method in ('exact', 'disambiguated', 'crosswalk', 'manual_override',
                          'public_correction', 'whole_parent', 'independent_city'));

comment on column geo_district_map.match_method is
  'How this row was resolved. There is deliberately no fuzzy value: guardrail 1 says an '
  'unresolved LGU is a published finding and a wrongly-matched one is an invisible lie, so the '
  'absence is enforced by this constraint rather than remembered by an implementer. '
  'independent_city = the name matched exactly, but against a province scope widened to include '
  'an independent city that the province page''s own lead sentence says its districts represent.';
