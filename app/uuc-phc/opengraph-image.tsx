import { ImageResponse } from "next/og";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { getUucPhcCounts } from "@/lib/db/uuc-phc";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social card for the section landing page, mirroring app/bhw/opengraph-image.tsx (plan U6).
 *
 * **The count is the headline**, because it is the whole finding: this is a membership list, and
 * "5,991 of 41,958 barangays" is the entire figure the page exists to state. A link preview is
 * where most people will first meet this list — it is circulated in exactly the settings where one
 * matters — so the preview carries the number rather than a title alone.
 *
 * No indicator values appear here, for U4's reason: a 1200×630 card has nowhere to put the †
 * footnote a capped value needs, and a bounded figure reproduced without it is the unmarked
 * artefact U3 was built to prevent. Counts carry no such caveat.
 *
 * Every line is composed as one string rather than interpolated between JSX text nodes: Satori
 * (next/og's renderer) throws on a `<div>` with more than one child unless it declares an explicit
 * `display`, and the failure is a 500 on the image route that no type or lint check would catch.
 */
export default async function Image() {
  const counts = await getUucPhcCounts(NATIONAL_GEO_CODE, "national");

  const listed = (counts?.nListed ?? 5991).toLocaleString();
  const total = (counts?.nBarangays ?? 41958).toLocaleString();
  const share = counts?.sharePct === null || counts === undefined ? "" : ` · ${counts?.sharePct}%`;

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
        <div style={{ display: "flex", fontSize: 30, color: "#0a6e6e", fontWeight: 600 }}>
          UUC for PHC · 2025
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: "#1a1d1e",
            marginTop: 20,
          }}
        >
          {`${listed} unserved and underserved barangays`}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#57616a", marginTop: 30 }}>
          {`of ${total} in the Philippines${share} · DC No. 2025-0549`}
        </div>
      </div>
    ),
    { ...size },
  );
}
