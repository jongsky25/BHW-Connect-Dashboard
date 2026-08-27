/**
 * Pure presentation-deck logic, split from the provider so it unit-tests in
 * vitest's node environment (no jsdom): slide ordering, position clamping,
 * and keyboard-intent mapping.
 */

// Node.DOCUMENT_POSITION_FOLLOWING — inlined so this module has no DOM
// dependency (the Node global doesn't exist in node-environment tests).
const DOCUMENT_POSITION_FOLLOWING = 4;

type DocumentOrderable = {
  el: { compareDocumentPosition(other: never): number };
};

/**
 * Sort slide registrations by their wrapper's position in the document, so the
 * deck order matches the page order regardless of React effect ordering or
 * conditional slides registering late.
 */
export function sortByDocumentOrder<T extends DocumentOrderable>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.el.compareDocumentPosition(b.el as never) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/**
 * Section name printed above every promoted slide and on the closing slide.
 *
 * Default rather than required (plan U6): the deck chrome hard-coded the literal "BHW Connect",
 * which is right for /bhw, /place, /explore and /compare and wrong for every other section — a
 * UUC for PHC deck would have carried the BHW Census's name above each of its slides. Carrying it
 * on DeckMeta makes it a fact the page states, and defaulting it keeps every existing caller
 * unchanged: a page that says nothing still presents as BHW Connect.
 */
export const DEFAULT_BRAND_LABEL = "BHW Connect";

export function brandLabelOf(meta: { brandLabel?: string }): string {
  // Blank is treated as unset: an empty header reads as a rendering bug, not as a deliberate
  // choice, and a page with nothing to say here wants the default.
  const label = meta.brandLabel?.trim();
  return label ? label : DEFAULT_BRAND_LABEL;
}

/** Keep a stored slide position in bounds when the live slide count changes. */
export function clampIndex(rawIndex: number, count: number): number {
  return Math.max(0, Math.min(rawIndex, count - 1));
}

export type SlideKeyIntent = "next" | "prev" | "first" | "last" | "toggle-overview" | "dismiss";

/**
 * Map a keydown to a deck action, or null when the event belongs to the slide
 * content: already consumed (defaultPrevented — FigureTabs' tablist and the
 * map mini-card), targeting a form control (the map's indicator <select>,
 * search inputs), or Space on a focused interactive element (which would both
 * click it and advance).
 */
export function slideKeyIntent(event: {
  key: string;
  defaultPrevented: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
  targetIsInteractive?: boolean;
}): SlideKeyIntent | null {
  if (event.defaultPrevented) return null;
  const tag = event.targetTagName?.toUpperCase() ?? null;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return null;
  if (event.targetIsContentEditable) return null;
  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
      return "next";
    case " ":
      return event.targetIsInteractive ? null : "next";
    case "ArrowLeft":
    case "PageUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "o":
    case "O":
      return "toggle-overview";
    case "Escape":
      return "dismiss";
    default:
      return null;
  }
}
