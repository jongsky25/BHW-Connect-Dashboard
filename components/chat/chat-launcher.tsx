"use client";

import { useRef, useState } from "react";
import type { GeoLevel } from "@/lib/filters/schema";
import { logEvent } from "@/lib/usage/log-client";

const SESSION_KEY = "bhw-connect-session-id";

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const TOOL_LABELS: Record<string, string> = {
  listAvailableIndicators: "the list of available indicators",
  getIndicatorByGeo: "figures for this place",
  compareGeos: "a comparison across places",
  getTrainingCoverage: "training coverage",
  getHonorariumStats: "honorarium figures",
  getDataCompleteness: "data completeness",
  searchGeo: "a place lookup",
};

const STARTER_QUESTIONS = [
  "How many BHWs are validated profiles vs. the total?",
  "What's the biggest training gap nationally?",
  "Which region has the highest accreditation rate?",
];

type ChatMessage = { role: "user" | "assistant" | "system"; content: string; cached?: boolean };
type StreamEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "message"; content: string; provider: string | null; cached?: boolean }
  | { type: "capacity"; message: string }
  | { type: "error"; message: string };

export function ChatLauncher({
  geoCode,
  geoLevel,
  geoName,
}: {
  geoCode?: string;
  geoLevel?: GeoLevel;
  geoName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [toolTrace, setToolTrace] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const listRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const text = question.trim();
    if (!text || status === "sending") return;

    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setInput("");
    setToolTrace([]);
    setStatus("sending");
    logEvent("ai_chat_open_question", { geoCode });

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          geoCode,
          geoLevel,
          messages: history.filter((m) => m.role !== "system"),
        }),
      });

      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        setMessages([...history, { role: "system", content: body?.error ?? "Rate limit reached — please wait a bit." }]);
        setStatus("idle");
        return;
      }
      if (!res.ok || !res.body) throw new Error("chat request failed");

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
            setToolTrace((prev) => [...prev, TOOL_LABELS[event.name] ?? event.name]);
          } else if (event.type === "message") {
            setMessages((prev) => [...prev, { role: "assistant", content: event.content, cached: event.cached }]);
          } else if (event.type === "capacity" || event.type === "error") {
            setMessages((prev) => [...prev, { role: "system", content: event.message }]);
          }
        }
      }
      setStatus("idle");
    } catch {
      setMessages((prev) => [...prev, { role: "system", content: "Something went wrong — please try again." }]);
      setStatus("error");
    } finally {
      setToolTrace([]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-30 rounded-full bg-accent px-4 py-3 text-sm font-medium text-accent-foreground shadow-lg hover:opacity-90"
      >
        Ask the data
      </button>
    );
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-30 flex h-[70vh] max-h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl sm:inset-x-auto sm:right-4 sm:w-96">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Ask the data</p>
          {geoName && <p className="text-xs text-muted">Currently viewing {geoName}</p>}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="rounded-md px-2 py-1 text-muted hover:bg-surface"
        >
          ✕
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Ask a question about BHW figures. Answers are AI-generated and grounded only in this
              site&apos;s own data — see{" "}
              <a href="/methodology#ai" className="underline hover:text-accent">
                how this works
              </a>
              .
            </p>
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <li
              key={i}
              className={
                m.role === "user"
                  ? "ml-6 rounded-md bg-accent-subtle px-3 py-2 text-sm"
                  : m.role === "system"
                    ? "rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted"
                    : "mr-6 rounded-md border border-border px-3 py-2 text-sm"
              }
            >
              {m.content}
              {m.cached && (
                <span className="mt-1 block text-[10px] text-muted">
                  Instant answer from a previously verified response
                </span>
              )}
            </li>
          ))}
        </ul>

        {status === "sending" && (
          <p className="mt-3 text-xs text-muted">
            {toolTrace.length > 0 ? `Looking up ${toolTrace[toolTrace.length - 1]}…` : "Thinking…"}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-border p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about accreditation, training, honorarium…"
          maxLength={2000}
          disabled={status === "sending"}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "sending" || input.trim().length === 0}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
