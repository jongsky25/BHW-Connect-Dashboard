import {
  createLoader,
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";
import {
  DEFAULT_MAP_INDICATOR,
  DEFAULT_REL_X,
  DEFAULT_REL_Y,
  DEMOGRAPHIC_DIMENSIONS,
  GEO_LEVELS,
  INDICATORS,
  REL_AXIS_INDICATORS,
  NATIONAL_GEO_CODE,
  normalizeMapIndicator,
} from "./schema";

/**
 * `mapIndicator` isn't a plain enum — it's the five base indicators plus
 * `training:<topic_slug>` — so it needs a custom parser. Unrecognised values
 * normalize back to the default accreditation view (never throw), matching the
 * rest of the codec. The default is omitted from serialized URLs by nuqs.
 */
const parseAsMapIndicator = createParser({
  parse: (v) => normalizeMapIndicator(v),
  serialize: (v) => v,
}).withDefault(DEFAULT_MAP_INDICATOR);

/**
 * The single source of truth for filter state: URL search params, typed via nuqs.
 * Every explore/place/compare view reads and writes exclusively through this codec,
 * so every view is a shareable permalink. Unknown/invalid enum values parse to `null`
 * (nuqs's behavior) and `.withDefault(...)` resolves that back to the national view —
 * malformed params never throw, they just fall back.
 */
export const filterParsers = {
  geoLevel: parseAsStringEnum([...GEO_LEVELS]).withDefault("national"),
  geoCode: parseAsString.withDefault(NATIONAL_GEO_CODE),
  indicator: parseAsStringEnum([...INDICATORS]),
  mapIndicator: parseAsMapIndicator,
  relX: parseAsStringEnum([...REL_AXIS_INDICATORS]).withDefault(DEFAULT_REL_X),
  relY: parseAsStringEnum([...REL_AXIS_INDICATORS]).withDefault(DEFAULT_REL_Y),
  compareGeos: parseAsArrayOf(parseAsString),
  breakdowns: parseAsArrayOf(parseAsStringEnum([...DEMOGRAPHIC_DIMENSIONS])),
};

/**
 * `compareGeos` reads/writes as `?geos=` in the URL, matching BUILD_PLAN.md §7 1.7's spec exactly.
 *
 * Every consumer of `filterParsers` MUST apply this mapping — server loaders and
 * serializers here, and client hooks via `useFilterState` (lib/filters/use-filter-state.ts).
 * A `useQueryStates(filterParsers)` call without it reads/writes `?compareGeos=`,
 * which the server never sees — that exact mismatch silently broke every
 * interactive control on /compare while permalinks kept working.
 */
export const filterUrlKeys = { compareGeos: "geos" } as const;

/** Server-side: parse a `URLSearchParams`/`Request`/plain record into typed filter state. */
export const loadFilterState = createLoader(filterParsers, { urlKeys: filterUrlKeys });

/** Build a query string (or full URL, given a base) from filter state — for permalinks/exports. */
export const serializeFilterState = createSerializer(filterParsers, { urlKeys: filterUrlKeys });
