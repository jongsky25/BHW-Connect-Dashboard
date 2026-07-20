// Client-only helpers that turn a click on the page into enough context to reproduce and fix what
// the submitter is pointing at: a stable selector for the element, a structured description, and a
// best-effort screenshot with the pin drawn on it. All functions here touch `window`/`document`
// and must only run in the browser (called from components/feedback/spot-feedback.tsx).

/** Structured description of the pinned element — stored as the `context` jsonb column. */
export type ElementContext = {
  tag: string;
  id: string | null;
  elementText: string;
  ariaLabel: string | null;
  role: string | null;
  rect: { x: number; y: number; width: number; height: number };
  /** Click position as a fraction (0..1) of the viewport, so it can be re-placed at any size. */
  pin: { xFrac: number; yFrac: number };
  viewport: { w: number; h: number; dpr: number };
  scroll: { x: number; y: number };
  userAgent: string;
};

const MAX_SELECTOR_DEPTH = 5;
const MAX_ELEMENT_TEXT = 160;
/** Downscale screenshots so payloads stay small; wide dashboards render fine at this width. */
const MAX_SCREENSHOT_WIDTH = 1400;

/** Skip the feedback UI itself (FAB, overlay, pin, panel) when walking or screenshotting the page. */
function isFeedbackUi(el: Element | null): boolean {
  return !!el?.closest?.("[data-feedback-ui]");
}

/**
 * Build a selector that re-finds the element later. Prefers an `id`, then a `data-testid`
 * (both stable and unique), otherwise walks up to MAX_SELECTOR_DEPTH ancestors building a
 * `tag:nth-of-type` path — not globally unique, but enough to locate the region in the DOM.
 */
export function computeSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.body && depth < MAX_SELECTOR_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
    const selector =
      siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag;
    parts.unshift(selector);
    current = parent;
    depth += 1;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

/** Describe the clicked element and where within it the user clicked. */
export function describeElement(el: Element, clientX: number, clientY: number): ElementContext {
  const rect = el.getBoundingClientRect();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ELEMENT_TEXT);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    elementText: text,
    ariaLabel: el.getAttribute("aria-label"),
    role: el.getAttribute("role"),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    pin: {
      xFrac: window.innerWidth ? clientX / window.innerWidth : 0,
      yFrac: window.innerHeight ? clientY / window.innerHeight : 0,
    },
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    userAgent: navigator.userAgent,
  };
}

/** Return the element actually under a point, ignoring the feedback overlay/UI on top of it. */
export function elementAtPoint(clientX: number, clientY: number): Element | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  return stack.find((el) => !isFeedbackUi(el)) ?? null;
}

type Html2Canvas = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;

/**
 * Best-effort screenshot of the current viewport with the pin marked, returned as a JPEG data URL
 * (or null on any failure — the caller submits without it rather than blocking). Uses the
 * `html2canvas-pro` fork, dynamically imported so it never ships in the initial bundle and because
 * it (unlike the original) parses Tailwind v4's `oklch()` colors. Known limitation: MapLibre's
 * WebGL canvas renders blank here, so map screenshots won't show tiles — the selector + DOM context
 * remain the reliable signal for those.
 */
export async function captureScreenshot(pin: { xFrac: number; yFrac: number }): Promise<string | null> {
  try {
    const mod = (await import("html2canvas-pro")) as unknown as { default: Html2Canvas };
    const html2canvas = mod.default;
    const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / Math.max(1, window.innerWidth));

    const canvas = await html2canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: null,
      ignoreElements: (el: Element) => isFeedbackUi(el),
    });

    drawPin(canvas, pin);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

/** Draw a red pin dot with a white ring at the pin's fractional position on the captured canvas. */
function drawPin(canvas: HTMLCanvasElement, pin: { xFrac: number; yFrac: number }): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const x = pin.xFrac * canvas.width;
  const y = pin.yFrac * canvas.height;
  const r = Math.max(8, canvas.width * 0.008);

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#b3261e";
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.35);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}
