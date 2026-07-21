"use client";

import type { TransitionStartFunction } from "react";
// eslint-disable-next-line no-restricted-imports -- the one sanctioned call site; everything else goes through useFilterState.
import { useQueryStates } from "nuqs";
import { filterParsers, filterUrlKeys } from "./codec";

/**
 * The one way client components read/write filter state. Wraps `useQueryStates`
 * with the three options every call site must agree on:
 *
 * - `urlKeys`: the same state-key -> URL-param mapping the server's
 *   `loadFilterState` uses (`compareGeos` <-> `?geos=`). Omitting it made the
 *   client write `?compareGeos=` while the server read `?geos=` — every add,
 *   remove, and quick-add on /compare updated the URL and changed nothing.
 * - `shallow: false`: URL changes must re-run the server component that
 *   fetches the data (DECISIONS.md, increment 1.4).
 * - `history: "push"`: each filter change is a Back-able step, not a
 *   replacement of the current entry (DECISIONS.md, increment 1.4).
 *
 * Direct `useQueryStates` imports are blocked by ESLint (`no-restricted-imports`)
 * so the mapping can't silently drift again.
 */
export function useFilterState(options?: { startTransition?: TransitionStartFunction }) {
  return useQueryStates(filterParsers, {
    urlKeys: filterUrlKeys,
    shallow: false,
    history: "push",
    ...options,
  });
}
