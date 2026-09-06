import { ImageResponse } from "next/og";
import { getGeoByCode } from "@/lib/db/geo";
import { NHFR_BRAND_LABEL, NHFR_SNAPSHOT_LABEL, getNhfrCounts } from "@/lib/db/nhfr";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { geoLevel: string; geoCode: string };

/**
 * Social card for an area, mirroring app/uuc-phc/[geoLevel]/[geoCode]/opengraph-image.tsx (U4's
 * rule, N4/N5's dataset).
 *
 * **A zero is rendered as a zero, never as an absence.** `agg_nhfr_counts` carries a row for every
 * geography (`lib/db/nhfr.ts`'s "a zero is data, not a gap"), so an area with nothing registered
 * reads "0 health facilities · 0 of N barangays have at least one" — the same rule the page and
 * the landing card follow, not a card that silently drops the figure.
 *
 * Two mechanics worth restating from the UUC card this mirrors, both found only by rendering the
 * image rather than by any check that runs in CI: `params` is a Promise on this Next version and
 * must be awaited, and Satori throws on a `<div>` with more than one child unless it declares an
 * explicit `display` — so every line here is composed as one string.
 */
export default async function Image({ params }: { params: Promise<Params> }) {
  const { geoLevel: rawLevel, geoCode } = await params;

  // The route segment is a plain string; validate it rather than casting, so a bad URL renders the
  // section card instead of issuing a query at a level the aggregate does not have.
  const geoLevel = (GEO_LEVELS as readonly string[]).includes(rawLevel)
    ? (rawLevel as GeoLevel)
    : null;
  const [geo, counts] = await Promise.all([
    getGeoByCode(geoCode),
    geoLevel ? getNhfrCounts(geoCode, geoLevel) : Promise.resolve(null),
  ]);

  const geoName = geo?.geoName ?? "Philippines";
  const figure = counts
    ? `${counts.nFacilities.toLocaleString()} health facilities · ${counts.nBarangaysWithFacility.toLocaleString()} of ${counts.nBarangays.toLocaleString()} barangays have at least one`
    : "DOH National Health Facility Registry";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#0a6e6e", fontWeight: 600 }}>
          {`${NHFR_BRAND_LABEL} · ${NHFR_SNAPSHOT_LABEL}`}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 700,
            color: "#1a1d1e",
            marginTop: 20,
          }}
        >
          {geoName}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#57616a", marginTop: 30 }}>
          {figure}
        </div>
      </div>
    ),
    { ...size },
  );
}
