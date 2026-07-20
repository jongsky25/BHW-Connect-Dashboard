import Link from "next/link";
import type { PlaceLocator } from "@/lib/geo/locator";
import type { GeoLevel } from "@/lib/filters/schema";

/**
 * Static locator-map thumbnail for the place profile header: the place
 * highlighted among its siblings, rendered as inline SVG on the server
 * (no MapLibre — this is a picture, not an interactive map). Links to the
 * full choropleth on /explore.
 */
export function LocatorMapThumbnail({
  locator,
  geoLevel,
  geoCode,
  placeName,
}: {
  locator: PlaceLocator;
  geoLevel: GeoLevel;
  geoCode: string;
  placeName: string;
}) {
  return (
    <Link
      href={`/explore?geoLevel=${geoLevel}&geoCode=${geoCode}`}
      aria-label={`View ${placeName} on the explore map`}
      className="group flex w-fit shrink-0 flex-col items-center gap-1 self-start rounded-md border border-border bg-surface/40 p-2 transition-colors hover:border-accent"
    >
      {/* Decorative — the link's aria-label carries the meaning. */}
      <svg viewBox={locator.viewBox} aria-hidden="true" className="h-28 w-28">
        <path
          d={locator.contextPath}
          className="fill-border/50 stroke-background"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={locator.highlightPath}
          className="fill-accent stroke-accent"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {locator.marker && (
          <circle
            cx={locator.marker.cx}
            cy={locator.marker.cy}
            r={6}
            className="fill-none stroke-accent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="text-[0.65rem] font-medium text-muted group-hover:text-accent">
        {locator.highlightIsParent ? `Within ${locator.highlightName}` : "View on map"}
      </span>
    </Link>
  );
}
