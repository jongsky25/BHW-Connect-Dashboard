import { ImageResponse } from "next/og";
import { getBhwCounts } from "@/lib/db/indicators";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const counts = await getBhwCounts("PH", "national");

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
        <div style={{ fontSize: 30, color: "#0a6e6e", fontWeight: 600 }}>BHW Connect</div>
        <div style={{ fontSize: 56, fontWeight: 700, color: "#1a1d1e", marginTop: 20 }}>
          Barangay Health Workers, in your barangay
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#57616a", marginTop: 30 }}>
          {counts?.nTotal?.toLocaleString() ?? "270,917"} BHWs ·{" "}
          {counts?.pctAccredited ?? "71.57"}% accredited · Philippines, 2025 snapshot
        </div>
      </div>
    ),
    { ...size },
  );
}
