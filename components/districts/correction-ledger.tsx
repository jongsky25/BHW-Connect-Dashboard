"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  PublicDistrictCorrection,
  PublicDistrictCorrectionStatus,
} from "@/lib/db/district-corrections";
import {
  CORRECTION_ACTION_LABEL,
  describeAcceptedOutcome,
  describeCorrectionChange,
} from "./correction-change";

const STATUS_FILTER_OPTIONS: { value: PublicDistrictCorrectionStatus | "all"; label: string }[] = [
  { value: "all", label: "Every proposal" },
  { value: "open", label: "Awaiting review" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Not accepted" },
  { value: "duplicate", label: "Already reported" },
];

const STATUS_LABEL: Record<PublicDistrictCorrectionStatus, string> = {
  open: "Awaiting review",
  accepted: "Accepted",
  rejected: "Not accepted",
  duplicate: "Already reported",
};

/** `rejected` is the only outcome given the danger colour. `duplicate` is not a judgment on the
 *  proposal — the same gap reported twice is a gap reported by two people — and `open` is not an
 *  outcome at all yet. */
const STATUS_CLASS: Record<PublicDistrictCorrectionStatus, string> = {
  open: "border border-border bg-surface text-muted",
  accepted: "bg-accent-subtle text-accent",
  rejected: "border border-border bg-surface text-danger",
  duplicate: "border border-border bg-surface text-muted",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The status + free-text filter, as a pure function so it can be tested directly — the component
 * around it only ever renders its unfiltered initial state under `renderToStaticMarkup`.
 *
 * The text matches the *submitted* wording and the *reviewer's* wording alike, not just the place
 * names: someone looking for how a class of proposal was handled ("already covered by", "not in
 * the source") is searching for the reasoning, which is the thing this page exists to publish.
 */
export function filterCorrections(
  corrections: PublicDistrictCorrection[],
  status: PublicDistrictCorrectionStatus | "all",
  query: string,
): PublicDistrictCorrection[] {
  const q = query.trim().toLowerCase();
  return corrections.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!q) return true;
    const haystack = [row.districtName, row.toDistrictName, row.geoName, row.rationale, row.reviewNote]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * D2.5 — the public ledger's list. Filtering is client-side for the same reason
 * `DistrictIndexTable`'s is: the server component already fetched the whole (small) list, so a
 * round trip per filter change would add latency and nothing else.
 *
 * Every proposal is shown in full — its rationale as submitted and its review note verbatim —
 * rather than summarised behind a link. A rejection whose reason nobody can read is
 * indistinguishable from being ignored, which is the failure mode this whole page exists to
 * prevent.
 */
export function CorrectionLedger({ corrections }: { corrections: PublicDistrictCorrection[] }) {
  const [status, setStatus] = useState<PublicDistrictCorrectionStatus | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => filterCorrections(corrections, status, query),
    [corrections, status, query],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted" htmlFor="correction-status-filter">
            Status
          </label>
          <select
            id="correction-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as PublicDistrictCorrectionStatus | "all")}
            className="mt-1 w-full min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label className="block text-xs font-medium text-muted" htmlFor="correction-search">
            Search
          </label>
          <input
            id="correction-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="District, place, or wording of the proposal…"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        Showing {filtered.length.toLocaleString()} of {corrections.length.toLocaleString()}{" "}
        proposal{corrections.length === 1 ? "" : "s"}.
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">
          No proposal matches this filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((row) => (
            <LedgerEntry key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LedgerEntry({ row }: { row: PublicDistrictCorrection }) {
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
          {CORRECTION_ACTION_LABEL[row.action]}
        </span>
        <span className="text-sm font-medium">{describeCorrectionChange(row)}</span>
        <span className="text-xs text-muted">
          submitted {formatDate(row.createdAt)}
          {row.reviewedAt ? ` · reviewed ${formatDate(row.reviewedAt)}` : ""}
        </span>
      </div>

      <div className="mt-2 rounded-md border border-border bg-surface p-3 text-sm">
        <p className="whitespace-pre-wrap">{row.rationale}</p>
        {row.evidenceUrl && (
          <p className="mt-1 text-xs">
            Evidence:{" "}
            <a
              href={row.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline hover:text-accent"
            >
              {row.evidenceUrl}
            </a>
          </p>
        )}
      </div>

      <div className="mt-2 text-sm">
        {row.status === "open" ? (
          <p className="text-muted">
            Not yet reviewed. Every proposal is judged by hand against the source the district page
            cites, and the reason is published here either way.
          </p>
        ) : (
          <>
            <p>
              <span className="font-medium">Review note:</span>{" "}
              {row.reviewNote ? (
                <span className="whitespace-pre-wrap">{row.reviewNote}</span>
              ) : (
                <span className="text-muted">
                  none recorded — this proposal was judged before a note was required.
                </span>
              )}
            </p>
            {row.status === "accepted" && (
              <p className="mt-1 text-muted">{describeAcceptedOutcome(row.action)}</p>
            )}
          </>
        )}
      </div>

      <DistrictLinks row={row} />
    </li>
  );
}

/**
 * Where to go to see the effect. An accepted `add`/`move` links the membership row it wrote, by
 * place name, on the district page that now carries it; everything else links the district pages
 * the proposal names, so a reader can always check the current state against what was proposed.
 */
function DistrictLinks({ row }: { row: PublicDistrictCorrection }) {
  const outcomeCodes = new Set(row.outcomeRows.map((o) => o.districtCode));
  const named = [
    { code: row.districtCode, name: row.districtName },
    { code: row.toDistrictCode, name: row.toDistrictName },
  ].filter(
    (d): d is { code: string; name: string | null } => Boolean(d.code) && !outcomeCodes.has(d.code!),
  );

  if (row.outcomeRows.length === 0 && named.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {row.outcomeRows.map((outcome) => (
        <li key={outcome.id}>
          <Link href={`/districts/${outcome.districtCode}`} className="underline hover:text-accent">
            {outcome.geoName ?? outcome.geoCode} in {outcome.districtName ?? outcome.districtCode}
          </Link>{" "}
          <span className="text-xs text-muted">— the row this wrote</span>
        </li>
      ))}
      {named.map((district) => (
        <li key={district.code}>
          <Link href={`/districts/${district.code}`} className="underline hover:text-accent">
            {district.name ?? district.code}
          </Link>
        </li>
      ))}
    </ul>
  );
}
