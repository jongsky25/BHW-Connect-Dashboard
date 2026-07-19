import { ImageResponse } from "next/og";
import { getBhwCounts } from "@/lib/db/indicators";
import { getGeoByCode } from "@/lib/db/geo";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { geoLevel: string; geoCode: string };

export default async function Image({ params }: { params: Params }) {
  const [geo, counts] = await Promise.all([
    getGeoByCode(params.geoCode),
    getBhwCounts(params.geoCode, params.geoLevel as never),
  ]);

  const geoName = geo?.geoName ?? "Philippines";

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
        <div style={{ fontSize: 26, color: "#0a6e6e", fontWeight: 600 }}>BHW Connect</div>
        <div style={{ fontSize: 60, fontWeight: 700, color: "#1a1d1e", marginTop: 20 }}>
          {geoName}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#57616a", marginTop: 30 }}>
          {counts?.nTotal !== null && counts?.nTotal !== undefined
            ? `${counts.nTotal.toLocaleString()} BHWs`
            : "BHW figures"}
          {counts?.pctAccredited !== null && counts?.pctAccredited !== undefined
            ? ` · ${counts.pctAccredited}% accredited`
            : ""}{" "}
          · 2025 snapshot
        </div>
      </div>
    ),
    { ...size },
  );
}
