import { ImageResponse } from "next/og";
import { NATIONAL_GEO_CODE } from "@/lib/filters/schema";
import { NHFR_BRAND_LABEL, NHFR_SNAPSHOT_LABEL, getNhfrCounts } from "@/lib/db/nhfr";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social card for the section landing page, mirroring app/uuc-phc/opengraph-image.tsx (U4's rule).
 *
 * **The facility count is the headline.** `lib/db/nhfr.ts` documents this dataset as an inventory
 * of places, not a measurement — "44,799 health facilities" is the entire figure the page exists
 * to state, the same reason the UUC card leads with its listed-barangay count. Unlike that
 * indicator work, NHFR carries no capped or footnoted values at all, so there is no † this card
 * could strand — nothing here needed U4's restraint to exclude, it simply has nothing to exclude.
 *
 * Every line is composed as one string rather than interpolated between JSX text nodes: Satori
 * (next/og's renderer) throws on a `<div>` with more than one child unless it declares an explicit
 * `display`, the failure U4's write-up found only by rendering the image.
 */
export default async function Image() {
  const counts = await getNhfrCounts(NATIONAL_GEO_CODE, "national");

  const facilities = (counts?.nFacilities ?? 44799).toLocaleString();
  const covered = (counts?.nBarangaysWithFacility ?? 28490).toLocaleString();
  const total = (counts?.nBarangays ?? 41958).toLocaleString();

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
          {`${NHFR_BRAND_LABEL} · ${NHFR_SNAPSHOT_LABEL}`}
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
          {`${facilities} health facilities`}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#57616a", marginTop: 30 }}>
          {`${covered} of ${total} barangays have at least one · DOH National Health Facility Registry`}
        </div>
      </div>
    ),
    { ...size },
  );
}
