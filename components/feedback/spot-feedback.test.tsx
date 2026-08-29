import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { FeedbackFab } from "@/components/feedback/spot-feedback";

/**
 * The FAB is icon-only, so its accessible name comes entirely from `aria-label` — there is no
 * visible text left to fall back on. That makes an unlabelled or stale-labelled button a silent
 * regression: it looks right and is unusable with a screen reader. These assert the name in both
 * states rather than trusting the JSX.
 */
function renderFab(isActive: boolean) {
  const { document } = parseHTML(
    `<html><body>${renderToStaticMarkup(
      <FeedbackFab isActive={isActive} onClick={() => {}} />,
    )}</body></html>`,
  );
  const button = document.querySelector("button");
  if (!button) throw new Error("FeedbackFab rendered no button");
  return button;
}

describe("FeedbackFab", () => {
  it("has an accessible name in the idle state", () => {
    const button = renderFab(false);
    expect(button.getAttribute("aria-label")).toBe("Give feedback");
    expect(button.getAttribute("title")).toBe("Give feedback");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("has a different, correct accessible name in the active state", () => {
    const button = renderFab(true);
    expect(button.getAttribute("aria-label")).toBe("Cancel feedback mode");
    expect(button.getAttribute("title")).toBe("Cancel feedback mode");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("names the two states differently, so the label actually tracks state", () => {
    expect(renderFab(false).getAttribute("aria-label")).not.toBe(
      renderFab(true).getAttribute("aria-label"),
    );
  });

  it("carries no visible text in either state — the icon is the whole button", () => {
    for (const isActive of [false, true]) {
      const button = renderFab(isActive);
      expect(button.textContent?.trim()).toBe("");
      expect(button.querySelectorAll("svg")).toHaveLength(1);
      // The icon must not leak into the accessible name.
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("swaps the chat icon for a close icon while active", () => {
    const idlePath = renderFab(false).querySelector("path")?.getAttribute("d");
    const activePath = renderFab(true).querySelector("path")?.getAttribute("d");
    expect(idlePath).toBeTruthy();
    expect(activePath).toBeTruthy();
    expect(idlePath).not.toBe(activePath);
  });

  it("keeps a 44x44 hit target after the label is dropped", () => {
    // Tailwind h-11/w-11 = 2.75rem = 44px, meeting WCAG 2.5.5 Target Size (Enhanced) and well
    // clear of the 24x24 minimum in 2.5.8. Asserted as classes because there is no layout engine
    // here; the point is that the size is pinned explicitly and not left to padding.
    for (const isActive of [false, true]) {
      const cls = renderFab(isActive).getAttribute("class") ?? "";
      expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["h-11", "w-11", "rounded-full"]));
      // The old pill padding must be gone, or the button is not compact.
      expect(cls).not.toMatch(/\bpx-4\b/);
      expect(cls).not.toMatch(/\bpy-3\b/);
    }
  });
});
