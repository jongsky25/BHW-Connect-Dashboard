"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PresentationDeck } from "./presentation-deck";
import { clampIndex, slideKeyIntent, sortByDocumentOrder } from "./deck-logic";

/**
 * Serializable deck header facts, computed by the server page and shown on the
 * auto-generated title/closing slides (the figures themselves stay in the page
 * tree — see PresentationSlide).
 */
export type DeckMeta = {
  /** Page name shown under the area, e.g. "Explore" or "Place profile". */
  pageLabel: string;
  /** Headline of the title slide, e.g. the geo's name or "Philippines". */
  areaName: string;
  /** Active filter labels rendered as pills on the title slide; may be empty. */
  filterChips: string[];
  /** The page's WPSAR caption line, e.g. "N = 270,917 validated profiles · …". */
  captionLine: string;
};

export type SlideInfo = { id: string; title: string };

type SlideRegistration = SlideInfo & { el: HTMLElement };

type PresentationContextValue = {
  active: boolean;
  /** 0 = title slide, 1..slides.length = content slides, count-1 = closing. */
  index: number;
  /** Total slide count including the generated title and closing slides. */
  count: number;
  slides: SlideInfo[];
  /** Id of the content slide currently promoted to fullscreen, if any. */
  activeSlideId: string | null;
  overviewOpen: boolean;
  meta: DeckMeta;
  start: () => void;
  exit: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  setOverviewOpen: (open: boolean) => void;
  register: (registration: SlideRegistration) => () => void;
};

const PresentationContext = createContext<PresentationContextValue | null>(null);

export function usePresentation(): PresentationContextValue {
  const value = useContext(PresentationContext);
  if (!value) throw new Error("usePresentation must be used within PresentationProvider");
  return value;
}

/**
 * Presentation ("Present") mode: turns the page into a full-screen slide deck
 * without moving any component. Sections wrapped in PresentationSlide stay
 * mounted exactly where they are in the page tree; the deck overlays an opaque
 * backdrop and the active slide's wrapper is promoted to a fixed fullscreen
 * box. Because the React tree never changes shape, chart tooltips, tab state,
 * and the MapLibre canvas all stay live across slide changes (same principle
 * as FigureTabs hiding panels instead of unmounting them).
 */
export function PresentationProvider({ meta, children }: { meta: DeckMeta; children: ReactNode }) {
  // Immutable registry state: each register/unregister produces a new Map, so
  // the slide list derives during render with no version counter or ref reads.
  const [registry, setRegistry] = useState<ReadonlyMap<string, SlideRegistration>>(new Map());

  const [active, setActive] = useState(false);
  // Stored position; the exposed `index` is clamped against the live slide
  // count at render time, because filter interactions inside a slide can
  // re-render the page and remove slides mid-presentation (e.g.
  // IncomeClassFigure only exists at national).
  const [rawIndex, setRawIndex] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(false);

  const register = useCallback((registration: SlideRegistration) => {
    setRegistry((prev) => {
      const next = new Map(prev);
      next.set(registration.id, registration);
      return next;
    });
    return () => {
      setRegistry((prev) => {
        const next = new Map(prev);
        next.delete(registration.id);
        return next;
      });
    };
  }, []);

  // Order comes from the DOM, not registration order, so conditional slides
  // and React effect ordering can't scramble the deck.
  const slides = useMemo<SlideInfo[]>(
    () => sortByDocumentOrder([...registry.values()]).map(({ id, title }) => ({ id, title })),
    [registry],
  );

  const count = slides.length + 2; // + generated title and closing slides
  const index = clampIndex(rawIndex, count);

  // Latest-value refs so the stable callbacks below never go stale.
  const countRef = useRef(count);
  const indexRef = useRef(index);
  const slidesRef = useRef(slides);
  const registryRef = useRef(registry);
  const activeRef = useRef(active);
  const overviewOpenRef = useRef(overviewOpen);
  useEffect(() => {
    countRef.current = count;
    indexRef.current = index;
    slidesRef.current = slides;
    registryRef.current = registry;
    activeRef.current = active;
    overviewOpenRef.current = overviewOpen;
  });

  const goTo = useCallback((i: number) => {
    setRawIndex(clampIndex(i, countRef.current));
    setOverviewOpen(false);
  }, []);
  const next = useCallback(() => {
    setRawIndex((r) => clampIndex(clampIndex(r, countRef.current) + 1, countRef.current));
  }, []);
  const prev = useCallback(() => {
    setRawIndex((r) => clampIndex(clampIndex(r, countRef.current) - 1, countRef.current));
  }, []);

  const start = useCallback(() => {
    setActive(true);
    setRawIndex(0);
    setOverviewOpen(false);
    // True fullscreen is an enhancement; browsers that deny it (e.g. iOS
    // Safari has no Fullscreen API on iPhone) still get the fixed overlay.
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    const i = indexRef.current;
    const current = slidesRef.current[i - 1];
    const el = current ? registryRef.current.get(current.id)?.el : null;
    setActive(false);
    setOverviewOpen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // After the slide un-promotes, land the page scroll where the user left off.
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
  }, []);

  // Scroll lock + `data-presenting` flag on <html> for the duration of the
  // presentation (styling hook for anything that should hide while presenting).
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    root.setAttribute("data-presenting", "");
    return () => {
      root.style.overflow = prevOverflow;
      root.removeAttribute("data-presenting");
    };
  }, [active]);

  // The browser's native Esc-exits-fullscreen should also end the presentation
  // (one Escape gesture, one level of dismissal — the deck was fullscreen).
  useEffect(() => {
    if (!active) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && activeRef.current) exit();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [active, exit]);

  // Deck-level keyboard navigation. Skips events a slide already consumed
  // (FigureTabs' tablist and the map mini-card both preventDefault) and events
  // targeting form controls, so arrow keys still work inside the map's
  // indicator <select> and search inputs.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const intent = slideKeyIntent({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        targetTagName: target?.tagName ?? null,
        targetIsContentEditable: target?.isContentEditable ?? false,
        targetIsInteractive: Boolean(target?.closest("button, a, summary, [role='tab']")),
      });
      if (!intent) return;
      switch (intent) {
        case "next":
          e.preventDefault();
          next();
          break;
        case "prev":
          e.preventDefault();
          prev();
          break;
        case "first":
          e.preventDefault();
          goTo(0);
          break;
        case "last":
          e.preventDefault();
          goTo(countRef.current - 1);
          break;
        case "toggle-overview":
          setOverviewOpen((v) => !v);
          break;
        case "dismiss":
          // Without fullscreen (denied/unsupported) Escape reaches us directly;
          // dismiss the overview first, then the presentation.
          if (overviewOpenRef.current) setOverviewOpen(false);
          else exit();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, next, prev, goTo, exit]);

  // Cheap insurance for any chart or map that listens to window resize rather
  // than observing its container: nudge once the promoted slide has laid out.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(raf);
  }, [active, index]);

  const activeSlideId =
    active && index >= 1 && index <= slides.length ? slides[index - 1].id : null;

  const value = useMemo<PresentationContextValue>(
    () => ({
      active,
      index,
      count,
      slides,
      activeSlideId,
      overviewOpen,
      meta,
      start,
      exit,
      next,
      prev,
      goTo,
      setOverviewOpen,
      register,
    }),
    [
      active,
      index,
      count,
      slides,
      activeSlideId,
      overviewOpen,
      meta,
      start,
      exit,
      next,
      prev,
      goTo,
      register,
    ],
  );

  return (
    <PresentationContext.Provider value={value}>
      {children}
      {active && (
        <PresentationDeck
          meta={meta}
          slides={slides}
          index={index}
          count={count}
          overviewOpen={overviewOpen}
          onNext={next}
          onPrev={prev}
          onGoTo={goTo}
          onExit={exit}
          onToggleOverview={() => setOverviewOpen(!overviewOpen)}
        />
      )}
    </PresentationContext.Provider>
  );
}
