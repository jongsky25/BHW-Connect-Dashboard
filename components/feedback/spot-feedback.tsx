"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { logEvent } from "@/lib/usage/log-client";
import { getSessionId } from "@/lib/feedback/session";
import { CATEGORIES } from "@/components/feedback/feedback-form";
import {
  captureScreenshot,
  computeSelector,
  describeElement,
  elementAtPoint,
  type ElementContext,
} from "@/lib/feedback/capture";

type Mode = "idle" | "picking" | "commenting" | "sending" | "done" | "error";

type Rect = { x: number; y: number; width: number; height: number };

type Capture = { selector: string; context: ElementContext };

const PANEL_WIDTH = 320;

/**
 * Spot feedback: a floating button that lets a visitor pin any element on the page and comment on
 * it, capturing a selector, DOM context, the full URL (filter state), and a best-effort screenshot
 * so we can reproduce and fix without a back-and-forth. Mounted once globally in app/layout.tsx;
 * renders nothing on /admin. All of this widget's own DOM carries `data-feedback-ui` so the capture
 * helpers skip it (both when picking the target under the cursor and when screenshotting).
 */
export function SpotFeedback() {
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode>("idle");
  const [highlight, setHighlight] = useState<Rect | null>(null);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  const fabRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const screenshotRef = useRef<Promise<string | null> | null>(null);

  const reset = useCallback(() => {
    setMode("idle");
    setHighlight(null);
    setPin(null);
    setCapture(null);
    setMessage("");
    setEmail("");
    setWebsite("");
    setCategory("suggestion");
    screenshotRef.current = null;
    fabRef.current?.focus();
  }, []);

  // ESC cancels from any active state.
  useEffect(() => {
    if (mode === "idle" || mode === "done") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, reset]);

  // Focus the message field when the comment panel opens.
  useEffect(() => {
    if (mode === "commenting") messageRef.current?.focus();
  }, [mode]);

  function startPicking() {
    setMode("picking");
    setHighlight(null);
  }

  function onOverlayMove(e: React.MouseEvent) {
    const el = elementAtPoint(e.clientX, e.clientY);
    if (!el) {
      setHighlight(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setHighlight({ x: r.x, y: r.y, width: r.width, height: r.height });
  }

  function onOverlayClick(e: React.MouseEvent) {
    e.preventDefault();
    const el = elementAtPoint(e.clientX, e.clientY);
    if (!el) return;

    const context = describeElement(el, e.clientX, e.clientY);
    setCapture({ selector: computeSelector(el), context });
    setPin({ x: e.clientX, y: e.clientY });
    setHighlight(null);
    // Kick off the screenshot now (best-effort, non-blocking); submit awaits it if still pending.
    screenshotRef.current = captureScreenshot(context.pin);
    setMode("commenting");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!capture || mode === "sending") return;
    setMode("sending");

    try {
      const screenshot = (await screenshotRef.current) ?? undefined;
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          pagePath: pathname,
          pageUrl: window.location.href,
          category,
          message,
          email: email || undefined,
          website,
          selector: capture.selector,
          context: capture.context,
          screenshot,
        }),
      });
      if (!res.ok) throw new Error("failed");
      logEvent("feedback_submit", { meta: { category, mode: "spot" } });
      setMode("done");
    } catch {
      setMode("error");
    }
  }

  // Keep the widget off admin screens and the portal landing page.
  if (pathname.startsWith("/admin") || pathname === "/") return null;

  const isActive = mode !== "idle";
  const panelPos = pin ? clampPanel(pin) : null;

  return (
    <div data-feedback-ui>
      {/* Live region announces pick mode for screen-reader users. */}
      <div aria-live="polite" className="sr-only">
        {mode === "picking" ? "Feedback mode on. Click any part of the page to leave a comment." : ""}
      </div>

      {/* Picking overlay: intercepts hover + click so we target the element without triggering it. */}
      {mode === "picking" && (
        <div
          data-feedback-ui
          className="fixed inset-0 z-[60] cursor-crosshair"
          onMouseMove={onOverlayMove}
          onClick={onOverlayClick}
          onContextMenu={(e) => {
            e.preventDefault();
            reset();
          }}
        />
      )}

      {/* Hovered-element highlight while picking. */}
      {mode === "picking" && highlight && (
        <div
          data-feedback-ui
          aria-hidden
          className="pointer-events-none fixed z-[61] rounded-sm border-2 border-accent bg-accent/10"
          style={{
            left: highlight.x,
            top: highlight.y,
            width: highlight.width,
            height: highlight.height,
          }}
        />
      )}

      {/* Pin marker once an element is chosen. */}
      {pin && (mode === "commenting" || mode === "sending" || mode === "error") && (
        <div
          data-feedback-ui
          aria-hidden
          className="pointer-events-none fixed z-[61] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-danger shadow"
          style={{ left: pin.x, top: pin.y }}
        />
      )}

      {/* Comment panel. */}
      {panelPos && (mode === "commenting" || mode === "sending" || mode === "error") && (
        <div
          data-feedback-ui
          role="dialog"
          aria-label="Leave feedback on this element"
          className="fixed z-[62] rounded-lg border border-border bg-background p-4 shadow-lg"
          style={{ left: panelPos.x, top: panelPos.y, width: PANEL_WIDTH }}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Honeypot: hidden from real users, present for bots that fill every field. */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="spot-website">Leave this field blank</label>
              <input
                id="spot-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(ev) => setWebsite(ev.target.value)}
              />
            </div>

            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">Feedback on this spot</p>
              <button
                type="button"
                onClick={reset}
                className="rounded-md px-1 text-muted hover:text-foreground"
                aria-label="Cancel feedback"
              >
                ✕
              </button>
            </div>

            {capture?.context.elementText && (
              <p className="line-clamp-2 rounded-md bg-surface px-2 py-1 text-xs text-muted">
                “{capture.context.elementText}”
              </p>
            )}

            <div>
              <label htmlFor="spot-category" className="block text-xs font-medium">
                What&apos;s this about?
              </label>
              <select
                id="spot-category"
                value={category}
                onChange={(ev) =>
                  setCategory(ev.target.value as (typeof CATEGORIES)[number]["value"])
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="spot-message" className="block text-xs font-medium">
                Comment
              </label>
              <textarea
                id="spot-message"
                ref={messageRef}
                required
                maxLength={2000}
                rows={3}
                value={message}
                onChange={(ev) => setMessage(ev.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>

            <div>
              <label htmlFor="spot-email" className="block text-xs font-medium">
                Email <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="spot-email"
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>

            {mode === "error" && (
              <p className="text-xs text-danger" role="alert">
                Something went wrong. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={mode === "sending" || message.trim().length === 0}
              className="self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >
              {mode === "sending" ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      )}

      {/* Thank-you toast. */}
      {mode === "done" && (
        <div
          data-feedback-ui
          role="status"
          className="fixed bottom-6 right-6 z-[62] flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 shadow-lg"
        >
          <span className="text-sm">Thanks — your feedback has been sent.</span>
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-1 text-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating action button. */}
      {mode !== "done" && (
        <button
          ref={fabRef}
          type="button"
          data-feedback-ui
          onClick={() => (isActive ? reset() : startPicking())}
          aria-pressed={isActive}
          aria-label={isActive ? "Cancel feedback" : "Leave feedback"}
          title={isActive ? "Cancel feedback" : "Leave feedback"}
          className="fixed bottom-6 right-6 z-[63] flex items-center justify-center rounded-full bg-accent p-2.5 text-accent-foreground shadow-lg transition-colors hover:opacity-90"
        >
          {isActive ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.04 2 11c0 2.7 1.34 5.1 3.47 6.74L5 22l4.6-2.02c.77.18 1.58.27 2.4.27 5.52 0 10-4.04 10-9S17.52 2 12 2z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

/** Position the panel near the pin but fully on-screen. */
function clampPanel(pin: { x: number; y: number }): { x: number; y: number } {
  const margin = 12;
  const estHeight = 340;
  let x = pin.x + 16;
  let y = pin.y + 16;
  if (typeof window !== "undefined") {
    x = Math.min(x, window.innerWidth - PANEL_WIDTH - margin);
    x = Math.max(margin, x);
    y = Math.min(y, window.innerHeight - estHeight - margin);
    y = Math.max(margin, y);
  }
  return { x, y };
}
