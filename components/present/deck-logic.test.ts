import { describe, expect, it } from "vitest";
import { clampIndex, slideKeyIntent, sortByDocumentOrder } from "./deck-logic";

const DOCUMENT_POSITION_FOLLOWING = 4;
const DOCUMENT_POSITION_PRECEDING = 2;

/** Fake elements whose document order is their position in a shared list. */
function fakeElements(ids: string[]) {
  const order = new Map(ids.map((id, i) => [id, i]));
  return ids.map((id) => ({
    id,
    el: {
      id,
      compareDocumentPosition(other: { id: string }) {
        return (order.get(other.id) ?? 0) > (order.get(id) ?? 0)
          ? DOCUMENT_POSITION_FOLLOWING
          : DOCUMENT_POSITION_PRECEDING;
      },
    },
  }));
}

describe("sortByDocumentOrder", () => {
  it("orders registrations by document position, not registration order", () => {
    const [a, b, c, d] = fakeElements(["summary", "map", "distribution", "insights"]);
    // Registered out of order (React effects don't run in DOM order).
    const sorted = sortByDocumentOrder([d, b, a, c] as never[]) as unknown as { id: string }[];
    expect(sorted.map((s) => s.id)).toEqual(["summary", "map", "distribution", "insights"]);
  });

  it("does not mutate the input array", () => {
    const [a, b] = fakeElements(["one", "two"]);
    const input = [b, a];
    sortByDocumentOrder(input as never[]);
    expect(input[0]).toBe(b);
  });
});

describe("clampIndex", () => {
  it("passes in-bounds positions through", () => {
    expect(clampIndex(3, 10)).toBe(3);
  });

  it("clamps to the last slide when the deck shrinks (mid-presentation filter change)", () => {
    expect(clampIndex(9, 5)).toBe(4);
  });

  it("never goes below zero", () => {
    expect(clampIndex(-2, 5)).toBe(0);
  });
});

describe("slideKeyIntent", () => {
  const base = { defaultPrevented: false };

  it("maps navigation keys", () => {
    expect(slideKeyIntent({ ...base, key: "ArrowRight" })).toBe("next");
    expect(slideKeyIntent({ ...base, key: "PageDown" })).toBe("next");
    expect(slideKeyIntent({ ...base, key: "ArrowLeft" })).toBe("prev");
    expect(slideKeyIntent({ ...base, key: "PageUp" })).toBe("prev");
    expect(slideKeyIntent({ ...base, key: "Home" })).toBe("first");
    expect(slideKeyIntent({ ...base, key: "End" })).toBe("last");
    expect(slideKeyIntent({ ...base, key: "o" })).toBe("toggle-overview");
    expect(slideKeyIntent({ ...base, key: "O" })).toBe("toggle-overview");
    expect(slideKeyIntent({ ...base, key: "Escape" })).toBe("dismiss");
    expect(slideKeyIntent({ ...base, key: "x" })).toBeNull();
  });

  it("ignores events a slide already consumed (FigureTabs tablist, map mini-card)", () => {
    expect(slideKeyIntent({ key: "ArrowRight", defaultPrevented: true })).toBeNull();
    expect(slideKeyIntent({ key: "Escape", defaultPrevented: true })).toBeNull();
  });

  it("ignores events from form controls so their own keyboard behavior wins", () => {
    for (const targetTagName of ["SELECT", "INPUT", "TEXTAREA", "select"]) {
      expect(slideKeyIntent({ ...base, key: "ArrowRight", targetTagName })).toBeNull();
    }
    expect(
      slideKeyIntent({ ...base, key: "ArrowRight", targetIsContentEditable: true }),
    ).toBeNull();
  });

  it("advances on Space only when nothing interactive is focused", () => {
    expect(slideKeyIntent({ ...base, key: " " })).toBe("next");
    expect(slideKeyIntent({ ...base, key: " ", targetIsInteractive: true })).toBeNull();
    // Arrow keys have no click default, so they navigate even from a button.
    expect(slideKeyIntent({ ...base, key: "ArrowRight", targetIsInteractive: true })).toBe("next");
  });
});
