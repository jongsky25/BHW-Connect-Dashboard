"use client";

import {
  createContext,
  useContext,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";

type ExploreNavValue = {
  /** Pass to nuqs' `startTransition` option so non-shallow URL updates keep
   * `isPending` true until the RSC re-render settles. */
  startTransition: TransitionStartFunction;
  isPending: boolean;
};

const ExploreNavContext = createContext<ExploreNavValue>({
  // Default (outside the provider): run synchronously, never "pending".
  startTransition: (fn) => fn(),
  isPending: false,
});

export function useExploreNav(): ExploreNavValue {
  return useContext(ExploreNavContext);
}

/**
 * Shares one React transition across every Explore navigator — the geo cascade,
 * breadcrumb chips, and map drills all route through it — so a single top
 * progress bar can reflect the ~1–2s RSC re-render that a filter change
 * triggers (E0.6). Scoped to the Explore layout, not global.
 */
export function ExploreNavProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();

  return (
    <ExploreNavContext.Provider value={{ startTransition, isPending }}>
      <NavProgressBar active={isPending} />
      {children}
    </ExploreNavContext.Provider>
  );
}

/** Thin top progress bar shown while a filter navigation is pending. Purely
 * decorative (`aria-hidden`); the navigation result is announced by the page
 * content itself. */
function NavProgressBar({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className={`h-full bg-accent transition-[width,opacity] duration-300 ease-out ${
          active ? "w-full opacity-100" : "w-0 opacity-0"
        }`}
      />
    </div>
  );
}
