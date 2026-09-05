"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "@/lib/usage/log-client";
import { getSessionId } from "@/lib/feedback/session";

const ACTIONS = [
  { value: "add", label: "A place is missing from this district" },
  { value: "remove", label: "A place shouldn't be in this district" },
  { value: "move", label: "A place belongs to a different district" },
  { value: "rename", label: "This district's name is wrong" },
  { value: "other", label: "Something else" },
] as const;

type Action = (typeof ACTIONS)[number]["value"];

type GeoSearchResult = { geoCode: string; geoLevel: string; geoName: string };

/**
 * D2.3 — the correction submission `/districts/[districtCode]` (D2.2) already points to via its
 * "tell us" link. Structured, not free text (plan §5 D2.3): the shape below mirrors
 * `district_correction` exactly, so a proposal is diffable against the current mapping and
 * applyable without re-interpretation rather than becoming a triage queue nobody works.
 *
 * Reuses `/feedback`'s defences verbatim: honeypot field, session id, the 2,000-char rationale
 * cap, and an email that's optional and never published.
 */
export function CorrectionForm({
  districtCode,
  districtName,
  members,
  districtOptions,
}: {
  districtCode: string;
  districtName: string;
  members: { geoCode: string; geoName: string }[];
  districtOptions: { code: string; name: string }[];
}) {
  const [action, setAction] = useState<Action>("add");
  const [geoCode, setGeoCode] = useState("");
  const [toDistrictCode, setToDistrictCode] = useState("");
  const [rationale, setRationale] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  const needsGeo = action === "add" || action === "remove" || action === "move";
  const needsDestination = action === "move";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || status === "done") return;
    setStatus("submitting");

    try {
      const res = await fetch("/api/districts/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          action,
          districtCode,
          toDistrictCode: needsDestination ? toDistrictCode : undefined,
          geoCode: needsGeo ? geoCode : undefined,
          rationale,
          evidenceUrl: evidenceUrl || undefined,
          email: email || undefined,
          website,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("done");
      logEvent("district_correction_submit", { meta: { action, districtCode } });
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm">
        Thanks — your correction has been recorded for review. It carries no promise of being
        right by itself; an admin checks it against the source before anything changes. You can
        follow it on the{" "}
        <Link href="/districts/corrections" className="underline hover:text-accent">
          correction ledger
        </Link>
        , where it is published with the reason it was accepted or not.
      </p>
    );
  }

  const canSubmit =
    rationale.trim().length > 0 &&
    (!needsGeo || geoCode.length > 0) &&
    (!needsDestination || toDistrictCode.length > 0);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Honeypot: hidden from sighted/keyboard users via CSS, but present in the DOM for bots that fill every field. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="correction-website">Leave this field blank</label>
        <input
          id="correction-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="correction-action" className="block text-sm font-medium">
          What&apos;s wrong?
        </label>
        <select
          id="correction-action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value as Action);
            setGeoCode("");
            setToDistrictCode("");
          }}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {needsGeo &&
        (action === "add" ? (
          <GeoPicker
            label={`Which city, municipality, or barangay belongs in ${districtName}?`}
            geoCode={geoCode}
            onPick={(g) => setGeoCode(g.geoCode)}
          />
        ) : (
          <div>
            <label htmlFor="correction-member" className="block text-sm font-medium">
              Which member of {districtName}?
            </label>
            <select
              id="correction-member"
              required
              value={geoCode}
              onChange={(e) => setGeoCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select a place…
              </option>
              {members.map((m) => (
                <option key={m.geoCode} value={m.geoCode}>
                  {m.geoName}
                </option>
              ))}
            </select>
          </div>
        ))}

      {needsDestination && (
        <div>
          <label htmlFor="correction-to-district" className="block text-sm font-medium">
            Which district should it belong to instead?
          </label>
          <select
            id="correction-to-district"
            required
            value={toDistrictCode}
            onChange={(e) => setToDistrictCode(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select a district…
            </option>
            {districtOptions
              .filter((d) => d.code !== districtCode)
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="correction-rationale" className="block text-sm font-medium">
          Why? <span className="font-normal text-muted">(what you found, and where)</span>
        </label>
        <textarea
          id="correction-rationale"
          required
          maxLength={2000}
          rows={4}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {/* Said before submission, not after: D2.5 publishes this text verbatim on the ledger, so
            the person writing it has to know that while they are still writing it. */}
        <p className="mt-1 text-xs text-muted">
          Published as written on the{" "}
          <Link href="/districts/corrections" className="underline hover:text-accent">
            public correction ledger
          </Link>
          , along with the reviewer&apos;s decision. Please don&apos;t include anything personal.
        </p>
      </div>

      <div>
        <label htmlFor="correction-evidence" className="block text-sm font-medium">
          Evidence URL{" "}
          <span className="font-normal text-muted">
            (optional — an RA number, COMELEC page, or PSA release)
          </span>
        </label>
        <input
          id="correction-evidence"
          type="url"
          value={evidenceUrl}
          onChange={(e) => setEvidenceUrl(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="correction-email" className="block text-sm font-medium">
          Email <span className="font-normal text-muted">(optional — only if you want a reply)</span>
        </label>
        <input
          id="correction-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-muted">Never published — contact-back only.</p>
      </div>

      {status === "error" && (
        <p className="text-sm text-danger" role="alert">
          Something went wrong sending your correction. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting" || !canSubmit}
        className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Submit correction"}
      </button>
    </form>
  );
}

/** Free-text search for the "add" action, since a missing place isn't in `members` to pick from.
 *  Reuses `/api/geo/search`, the same endpoint the home page's "find my barangay" box calls, and
 *  filters to citymun/barangay client-side — `geo_district_map` never holds a region or province. */
function GeoPicker({
  label,
  geoCode,
  onPick,
}: {
  label: string;
  geoCode: string;
  onPick: (result: GeoSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [picked, setPicked] = useState<GeoSearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const currentRequest = ++requestId.current;
    const timeout = setTimeout(async () => {
      if (!trimmed) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(trimmed)}`);
        if (currentRequest !== requestId.current) return;
        const body = await res.json();
        const all: GeoSearchResult[] = body.results ?? [];
        setResults(all.filter((r) => r.geoLevel === "citymun" || r.geoLevel === "barangay"));
      } catch {
        if (currentRequest === requestId.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function pick(result: GeoSearchResult) {
    setPicked(result);
    onPick(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label htmlFor="correction-geo-search" className="block text-sm font-medium">
        {label}
      </label>
      {picked && geoCode === picked.geoCode ? (
        <div className="mt-1 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span>{picked.geoName}</span>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              onPick({ geoCode: "", geoLevel: "", geoName: "" });
            }}
            className="text-xs underline hover:text-accent"
          >
            Change
          </button>
        </div>
      ) : (
        <input
          id="correction-geo-search"
          type="search"
          autoComplete="off"
          placeholder="Start typing a city, municipality, or barangay name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      )}
      {open && query.trim().length > 0 && (!picked || geoCode !== picked.geoCode) && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-background shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matching places found.</li>
          ) : (
            results.map((r) => (
              <li key={r.geoCode}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  <span>{r.geoName}</span>
                  <span className="shrink-0 text-xs text-muted">{r.geoLevel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
