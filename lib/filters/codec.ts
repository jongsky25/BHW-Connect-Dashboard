import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";
import { DEMOGRAPHIC_DIMENSIONS, GEO_LEVELS, INDICATORS, NATIONAL_GEO_CODE } from "./schema";

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
  compareGeos: parseAsArrayOf(parseAsString),
  breakdowns: parseAsArrayOf(parseAsStringEnum([...DEMOGRAPHIC_DIMENSIONS])),
};

/** Server-side: parse a `URLSearchParams`/`Request`/plain record into typed filter state. */
export const loadFilterState = createLoader(filterParsers);

/** Build a query string (or full URL, given a base) from filter state — for permalinks/exports. */
export const serializeFilterState = createSerializer(filterParsers);
