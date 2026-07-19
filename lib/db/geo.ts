import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";

export type GeoOption = {
  geoCode: string;
  geoLevel: GeoLevel;
  geoName: string;
  incomeClass: number | null;
};

const CHILD_LEVEL: Record<GeoLevel, GeoLevel | null> = {
  national: "region",
  region: "province",
  province: "citymun",
  citymun: "barangay",
  barangay: null,
};

/**
 * Children of `parentCode` one geo level down, ordered by name, for cascading
 * filter selects (national -> region -> province -> city/mun -> barangay).
 * The national level has no single `parent_code` row to join on, so it's
 * special-cased to "all regions".
 */
export async function getChildGeos(
  parentCode: string,
  parentLevel: GeoLevel,
): Promise<GeoOption[]> {
  const childLevel = CHILD_LEVEL[parentLevel];
  if (!childLevel) return [];

  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("dim_geo")
    .select("geo_code, geo_level, geo_name, income_class")
    .eq("geo_level", childLevel)
    .order("geo_name", { ascending: true });

  if (parentLevel !== "national") {
    query = query.eq("parent_code", parentCode);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    geoCode: row.geo_code,
    geoLevel: row.geo_level,
    geoName: row.geo_name,
    incomeClass: row.income_class,
  }));
}

export async function getGeoByCode(geoCode: string): Promise<GeoOption | null> {
  if (geoCode === NATIONAL_GEO_CODE) {
    return { geoCode: NATIONAL_GEO_CODE, geoLevel: "national", geoName: "Philippines", incomeClass: null };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dim_geo")
    .select("geo_code, geo_level, geo_name, income_class")
    .eq("geo_code", geoCode)
    .maybeSingle();

  if (error || !data) return null;

  return {
    geoCode: data.geo_code,
    geoLevel: data.geo_level,
    geoName: data.geo_name,
    incomeClass: data.income_class,
  };
}

/**
 * Validates a (geoLevel, geoCode) pair against the DB and falls back to the
 * national view if the geo doesn't exist or the level doesn't match — so a
 * stale or hand-edited permalink never crashes a page, per BUILD_PLAN.md §7 1.2.
 */
export async function resolveGeoOrNational(
  geoCode: string,
  geoLevel: GeoLevel,
): Promise<GeoOption> {
  const geo = await getGeoByCode(geoCode);
  if (geo && geo.geoLevel === geoLevel) return geo;
  return { geoCode: NATIONAL_GEO_CODE, geoLevel: "national", geoName: "Philippines", incomeClass: null };
}

export type GeoAncestors = {
  region: GeoOption | null;
  province: GeoOption | null;
  citymun: GeoOption | null;
};

/**
 * The region/province/citymun ancestors of a geo (denormalized directly on
 * `dim_geo` at ingestion, per §4.1 — no recursive parent-chain walk needed).
 * Backs the cascading filter sidebar's hydration from a deep-linked geo.
 */
export async function getGeoAncestors(geoCode: string, geoLevel: GeoLevel): Promise<GeoAncestors> {
  const empty: GeoAncestors = { region: null, province: null, citymun: null };
  if (geoLevel === "national") return empty;

  const supabase = createSupabaseServerClient();
  const { data: self } = await supabase
    .from("dim_geo")
    .select("region_code, province_code, citymun_code")
    .eq("geo_code", geoCode)
    .maybeSingle();

  if (!self) return empty;

  const ancestorCodes = [self.region_code, self.province_code, self.citymun_code].filter(
    (code): code is string => Boolean(code),
  );
  if (ancestorCodes.length === 0) return empty;

  const { data: rows } = await supabase
    .from("dim_geo")
    .select("geo_code, geo_level, geo_name, income_class")
    .in("geo_code", ancestorCodes);

  const byCode = new Map((rows ?? []).map((row) => [row.geo_code, row]));
  const toOption = (code: string | null): GeoOption | null => {
    if (!code) return null;
    const row = byCode.get(code);
    if (!row) return null;
    return {
      geoCode: row.geo_code,
      geoLevel: row.geo_level,
      geoName: row.geo_name,
      incomeClass: row.income_class,
    };
  };

  return {
    region: toOption(self.region_code),
    province: toOption(self.province_code),
    citymun: toOption(self.citymun_code),
  };
}
