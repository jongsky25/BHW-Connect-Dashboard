/**
 * Cross-dataset suppression for the consolidated area profile
 * (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.4).
 *
 * Client-safe and pure — no `server-only` — so it unit-tests in vitest's node environment and can
 * be reasoned about without a database, which for a privacy guardrail matters more than usual.
 *
 * ## The gap this closes
 *
 * `ingestion/build_aggregates.sql` suppresses per *cell*: a barangay demographic cell with
 * `0 < n < 5` has its `n` and `pct` nulled and `is_suppressed` set. That is correct in isolation
 * and insufficient in aggregate, because the group total is published elsewhere and is not
 * suppressed (`agg_bhw_counts.n_total`).
 *
 * So for a barangay whose `sex` breakdown is Male 40 (visible) and Female 3 (suppressed), against
 * a validated-profile total of 43:
 *
 *     Female = 43 − 40 = 3
 *
 * One subtraction defeats the suppression. The rule is standard: a residual is only unknowable if
 * **at least two** cells in the group are unknown, so a group with exactly one suppressed cell
 * needs a second — a *complementary* suppression — chosen as the smallest visible positive cell,
 * which loses the least information.
 *
 * `pct` is nulled alongside `n` for the same reason the ingestion pass does it: `pct × total`
 * reconstructs `n` exactly.
 *
 * ## What this does and does not claim
 *
 * It protects **this payload**. It is not a fix to the aggregates, and the same differencing path
 * exists wherever a suppressed cell and its group total are published together — see `DECISIONS.md`
 * for the finding. Consolidation is what makes the path systematic and machine-readable, which is
 * why the pass belongs here even though the exposure predates it.
 */

/** The minimum a row must carry to participate. Structural, so the profile's own row type can
 * extend it without this module importing from the server-only data layer. */
export type SuppressibleCell = {
  dimension: string;
  category: string;
  n: number | null;
  pct: number | null;
  isSuppressed: boolean;
};

/** Why a cell is suppressed. `complement` rows were not small — they were withheld so a small
 * cell beside them stays unknowable, and a reader who is not told that will read them as missing. */
export type SuppressedBy = "small-cell" | "complement" | null;

export type SuppressedCell<T> = T & { suppressedBy: SuppressedBy };

export type ComplementarySuppressionResult<T> = {
  rows: SuppressedCell<T>[];
  /** Dimensions where the residual is still solvable and nothing in this payload can fix it. */
  unprotectable: string[];
  notes: string[];
};

/** A residual is unknowable only when at least this many cells in the group are unknown. */
const MIN_UNKNOWN_CELLS = 2;

function suppress<T extends SuppressibleCell>(row: T, by: SuppressedBy): SuppressedCell<T> {
  return { ...row, n: null, pct: null, isSuppressed: true, suppressedBy: by };
}

/**
 * Add complementary suppression to a set of demographic cells, grouped by dimension.
 *
 * Untouched when a group has no suppressed cell (nothing to protect) or two or more (already
 * unknowable). A group with exactly one gains a second, chosen as the smallest visible cell with
 * `n > 0` — a visible zero is not a candidate, because withholding it removes no ambiguity: the
 * attacker's sum is unchanged whether or not a known zero is hidden.
 */
export function applyComplementarySuppression<T extends SuppressibleCell>(
  cells: readonly T[],
): ComplementarySuppressionResult<T> {
  const byDimension = new Map<string, T[]>();
  for (const cell of cells) {
    const group = byDimension.get(cell.dimension);
    if (group) group.push(cell);
    else byDimension.set(cell.dimension, [cell]);
  }

  const out: SuppressedCell<T>[] = [];
  const unprotectable: string[] = [];
  const notes: string[] = [];

  for (const [dimension, group] of byDimension) {
    const unknown = group.filter((c) => c.isSuppressed).length;

    if (unknown === 0 || unknown >= MIN_UNKNOWN_CELLS) {
      for (const cell of group) {
        out.push({ ...cell, suppressedBy: cell.isSuppressed ? "small-cell" : null });
      }
      continue;
    }

    // Exactly one unknown: the residual is solvable against the published group total.
    const candidates = group
      .filter((c) => !c.isSuppressed && c.n !== null && c.n > 0)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0));

    const complement = candidates[0];
    if (!complement) {
      // Nothing left to withhold — every other cell is a known zero, or there are no others. The
      // suppressed cell equals the total minus known zeros no matter what this pass does, so say
      // so rather than pretending the group is protected.
      unprotectable.push(dimension);
      for (const cell of group) {
        out.push({ ...cell, suppressedBy: cell.isSuppressed ? "small-cell" : null });
      }
      continue;
    }

    for (const cell of group) {
      if (cell.isSuppressed) out.push({ ...cell, suppressedBy: "small-cell" });
      else if (cell === complement) out.push(suppress(cell, "complement"));
      else out.push({ ...cell, suppressedBy: null });
    }
    notes.push(
      `${dimension}: a second category was withheld so the suppressed one cannot be recovered by subtracting from the total.`,
    );
  }

  if (unprotectable.length > 0) {
    notes.push(
      `These breakdowns have only one unknown cell and no second to withhold, so the suppressed value is still derivable from the group total: ${unprotectable.join(", ")}. Do not state or estimate it.`,
    );
  }

  return { rows: out, unprotectable, notes };
}
