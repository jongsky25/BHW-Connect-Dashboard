import { ImageResponse } from "next/og";
import { getGeoByCode } from "@/lib/db/geo";
import { getUucPhcCounts } from "@/lib/db/uuc-phc";
import { GEO_LEVELS, type GeoLevel } from "@/lib/filters/schema";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { geoLevel: string; geoCode: string };

/**
 * Social card for an area, mirroring app/place/[geoLevel]/[geoCode]/opengraph-image.tsx (plan U6).
 *
 * **A zero is rendered as a zero, never as an absence.** `agg_uuc_phc_counts` carries a row for
 * every geography, so NCR reads "0 of 1,675" — the same rule the page and the PNG one-pager follow.
 * A card that silently omitted the figure for an area with nothing listed would read as "no data",
 * which is the one thing this dataset is not.
 *
 * Two mechanics worth stating, both found by rendering the image rather than by any check that
 * runs in CI: `params` is a Promise on this Next version and must be awaited, and Satori throws on
 * a `<div>` with more than one child unless it declares an explicit `display` — so every line here
 * is composed as one string.
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
    geoLevel ? getUucPhcCounts(geoCode, geoLevel) : Promise.resolve(null),
  ]);

  const geoName = geo?.geoName ?? "Philippines";
  const share = counts?.sharePct === null ? "" : ` · ${counts?.sharePct}%`;
  const figure = counts
    ? `${counts.nListed.toLocaleString()} of ${counts.nBarangays.toLocaleString()} barangays unserved or underserved${share} · DC No. 2025-0549`
    : "2025 list of unserved and underserved communities · DC No. 2025-0549";

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
          UUC for PHC · 2025
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
