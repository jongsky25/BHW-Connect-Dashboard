import { describe, expect, it } from "vitest";
import { buildLocatorMap, type BoundaryCollection } from "./locator";

/** Square polygon feature at the equator (no latitude distortion to reason about). */
function square(geoCode: string, x: number, y: number, size: number) {
  return {
    properties: { geo_code: geoCode },
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    },
  };
}

describe("buildLocatorMap", () => {
  it("returns null when the highlight code isn't in the collection", () => {
    const collection: BoundaryCollection = { features: [square("01", 0, 0, 1)] };
    expect(buildLocatorMap(collection, "99")).toBeNull();
  });

  it("splits features into context and highlight paths", () => {
    const collection: BoundaryCollection = {
      features: [square("01", 0, 0, 1), square("02", 1, 0, 1)],
    };
    const map = buildLocatorMap(collection, "02");
    expect(map).not.toBeNull();
    // Two equal squares side by side: viewBox spans 2:1.
    expect(map!.viewBox).toBe("0 0 200 100");
    // Each path is a single closed ring; the highlight isn't duplicated in context.
    expect(map!.contextPath).toMatch(/^M[\d .L]+Z$/);
    expect(map!.highlightPath).toMatch(/^M[\d .L]+Z$/);
    expect(map!.contextPath).not.toBe(map!.highlightPath);
    // Big highlight (half the canvas) needs no marker.
    expect(map!.marker).toBeNull();
  });

  it("collapses consecutive duplicate points after rounding", () => {
    const jittery = {
      properties: { geo_code: "01" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [0.0001, 0.0001], // rounds onto the previous point
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    };
    const map = buildLocatorMap({ features: [jittery] }, "01");
    // 5 distinct rounded points + close: M + 4 L segments.
    expect(map!.highlightPath.match(/L/g)?.length).toBe(4);
  });

  it("drops sub-pixel context rings but never highlight rings, adding a marker instead", () => {
    const collection: BoundaryCollection = {
      features: [
        square("big", 0, 0, 10),
        square("islet", 5, 5, 0.001), // < MIN_CONTEXT_RING_PX once projected
        square("target", 2, 2, 0.001),
      ],
    };
    const asContext = buildLocatorMap(collection, "big")!;
    // The islet and target collapse to a point and are dropped from context.
    expect(asContext.contextPath).toBe("");

    const asHighlight = buildLocatorMap(collection, "target")!;
    // Too small to see -> ring marker at its centre (2/10 of the 200px canvas).
    expect(asHighlight.marker).toEqual({ cx: 40, cy: 160 });
  });

  it("handles MultiPolygon highlights", () => {
    const multi = {
      properties: { geo_code: "01" },
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: [
          square("x", 0, 0, 1).geometry.coordinates,
          square("x", 2, 0, 1).geometry.coordinates,
        ],
      },
    };
    const map = buildLocatorMap({ features: [multi] }, "01")!;
    expect(map.highlightPath.match(/M/g)?.length).toBe(2);
    expect(map.contextPath).toBe("");
  });

  it("keeps y pointing down (north at the top)", () => {
    const collection: BoundaryCollection = {
      features: [square("north", 0, 1, 1), square("south", 0, -2, 1)],
    };
    const map = buildLocatorMap(collection, "north")!;
    // North square occupies the top of the canvas: its max projected y is well
    // above the canvas midpoint.
    const ys = [...map.highlightPath.matchAll(/[ML]\d+ (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThan(100);
  });
});
