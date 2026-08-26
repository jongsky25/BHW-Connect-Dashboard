"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type Turn = { role: "user" | "assistant" | "system"; content: string };
type ToolCall = { name: string; args: Record<string, unknown> };

type Citation = {
  chunkId: number;
  document: string;
  documentTitle: string;
  asOf: string | null;
  page: number;
  pageRange?: string;
  heading: string | null;
  text: string;
  truncated: boolean;
  charStart: number;
  charEnd: number;
  label: string;
};

type StreamEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "message"; content: string; provider: string | null }
  | { type: "citations"; citations: Citation[]; droppedPages: number[] }
  | { type: "capacity"; message: string }
  | { type: "error"; message: string };

/**
 * The internal assistant's surface (docs/AI_ASSISTANT_PLAN.md §8, Increment 1.4). Reads the same
 * NDJSON stream the public chat does, and differs in one way that matters: it shows each tool call
 * with its **arguments**, not a friendly label.
 *
 * That is not a debugging affordance. An internal answer is only as trustworthy as the query
 * behind it, and the difference between a right and a wrong answer here is usually a filter — a
 * missing `dataset_id`, a `geo_level` one step off. A staff reader who can see
 * `queryDataset {"table":"agg_poverty","filters":[…]}` can catch that; one shown "Looked up
 * poverty figures" cannot.
 *
 * Increment 2.3 adds sources on the same principle, one step further. §7: for a prose claim the
 * citation is the only check, so it is rendered as evidence to be *used* rather than a footnote to
 * be trusted — the exact stored passage is one click away, and the link resolves it from the
 * database rather than re-showing what the stream sent. Sources come from the retrieval payload,
 * so the model never authors them; a page it named but was not given is dropped upstream by
 * `auditCitations` and reported here rather than passing silently.
 */
export function AssistantChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [droppedPages, setDroppedPages] = useState<number[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const listRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const text = question.trim();
    if (!text || status === "sending") return;

    const history = [...turns, { role: "user" as const, content: text }];
    setTurns(history);
    setInput("");
    setToolCalls([]);
    setCitations([]);
    setDroppedPages([]);
    setStatus("sending");

    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((t) => t.role !== "system") }),
      });

      if (res.status === 401) {
        setTurns([
          ...history,
          { role: "system", content: "Your admin session has expired — sign in again." },
        ]);
        setStatus("idle");
        return;
      }
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        setTurns([
          ...history,
          { role: "system", content: body?.error ?? "Rate limit reached — wait a few minutes." },
        ]);
        setStatus("idle");
        return;
      }
      if (!res.ok || !res.body) throw new Error("assistant request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event: StreamEvent = JSON.parse(line);
          if (event.type === "tool_call") {
            setToolCalls((prev) => [...prev, { name: event.name, args: event.args }]);
          } else if (event.type === "message") {
            setTurns((prev) => [...prev, { role: "assistant", content: event.content }]);
          } else if (event.type === "citations") {
            setCitations(event.citations);
            setDroppedPages(event.droppedPages);
          } else {
            setTurns((prev) => [...prev, { role: "system", content: event.message }]);
          }
        }
      }
      setStatus("idle");
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "system", content: "Something went wrong — please try again." },
      ]);
      setStatus("error");
    } finally {
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={listRef}
        className="flex max-h-[60vh] min-h-[16rem] flex-col gap-3 overflow-y-auto rounded-lg border border-border p-4"
      >
        {turns.length === 0 && (
          <p className="text-sm text-muted">
            Ask across every registered dataset, or about anything in the ingested documents.
            Figures are grounded in tool results and pass the same numeric audit as the public chat;
            document claims come back with the passage they were drawn from, which you can open and
            read. Anything it cannot ground, it drops.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {turns.map((turn, i) => (
            <li
              key={i}
              className={
                turn.role === "user"
                  ? "ml-8 rounded-md bg-accent-subtle px-3 py-2 text-sm"
                  : turn.role === "system"
                    ? "rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted"
                    : "mr-8 whitespace-pre-wrap rounded-md border border-border px-3 py-2 text-sm"
              }
            >
              {turn.content}
            </li>
          ))}
        </ul>

        {toolCalls.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md bg-surface p-3">
            {toolCalls.map((call, i) => (
              <li key={i} className="font-mono text-[11px] text-muted">
                <span className="font-semibold">{call.name}</span>{" "}
                {Object.keys(call.args).length > 0 && JSON.stringify(call.args)}
              </li>
            ))}
          </ul>
        )}

        {droppedPages.length > 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
            Dropped {droppedPages.length === 1 ? "a sentence citing slide" : "sentences citing slides"}{" "}
            {droppedPages.join(", ")}: no document search this turn returned{" "}
            {droppedPages.length === 1 ? "it" : "them"}, so the citation could not be checked.
          </p>
        )}

        {citations.length > 0 && (
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs font-medium">
              {citations.length} source {citations.length === 1 ? "passage" : "passages"} retrieved
              for this answer
            </p>
            <ol className="flex flex-col gap-2">
              {citations.map((citation) => (
                <li key={citation.chunkId} className="text-xs">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{citation.label}</span>
                      {citation.heading && (
                        <span className="text-muted"> — {citation.heading}</span>
                      )}
                      {citation.asOf && (
                        <span className="text-muted"> · as of {citation.asOf}</span>
                      )}
                    </summary>
                    {/* The passage itself, not a summary of it: a citation is only a check if the
                        reader can compare the claim against the words it came from. */}
                    <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-surface p-2 text-[11px] leading-relaxed">
                      {citation.text}
                      {citation.truncated && "\n…(passage continues)"}
                    </pre>
                    <p className="mt-1 text-muted">
                      <Link
                        href={`/admin/assistant/source/${citation.chunkId}`}
                        className="underline"
                      >
                        Open the stored chunk
                      </Link>{" "}
                      <span className="font-mono">
                        #{citation.chunkId} · chars {citation.charStart.toLocaleString()}–
                        {citation.charEnd.toLocaleString()}
                      </span>
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        )}

        {status === "sending" && <p className="text-xs text-muted">Working…</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. which provinces are outliers on honorarium receipt?"
          maxLength={4000}
          disabled={status === "sending"}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "sending" || input.trim().length === 0}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
