"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { logEvent } from "@/lib/usage/log-client";
import { getSessionId } from "@/lib/feedback/session";

export const CATEGORIES = [
  { value: "bug", label: "Something's broken" },
  { value: "data_question", label: "A question about the data" },
  { value: "suggestion", label: "A suggestion" },
  { value: "other", label: "Something else" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

/**
 * The site's feedback form. Rendered standalone at /feedback, and embedded by a section that has a
 * specific correction to invite — the UUC for PHC list-correction disclosure (plan U6).
 *
 * The embedded case needs nothing from the caller but a starting category and its own element ids:
 * `pathname` is already the page the reader is on, and the API derives `feedback.dataset_slug`
 * from it, so a correction submitted from /uuc-phc/citymun/… lands tagged with both the dataset and
 * the exact area. That is why this is a prop or two rather than a second form.
 */
export function FeedbackForm({
  defaultCategory = "suggestion",
  /** Element-id namespace, so two forms can co-exist on one page without colliding labels. */
  idPrefix = "feedback",
  doneMessage = "Thanks — your feedback has been sent.",
}: {
  defaultCategory?: Category;
  idPrefix?: string;
  doneMessage?: string;
} = {}) {
  const pathname = usePathname();
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting" || status === "done") return;
    setStatus("submitting");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          pagePath: pathname,
          category,
          message,
          email: email || undefined,
          website,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("done");
      logEvent("feedback_submit", { meta: { category } });
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-md border border-border bg-surface px-4 py-6 text-center">
        {doneMessage}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Honeypot: hidden from sighted/keyboard users via CSS, but present in the DOM for bots that fill every field. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor={`${idPrefix}-website`}>Leave this field blank</label>
        <input
          id={`${idPrefix}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-category`} className="block text-sm font-medium">
          What&apos;s this about?
        </label>
        <select
          id={`${idPrefix}-category`}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-message`} className="block text-sm font-medium">
          Message
        </label>
        <textarea
          id={`${idPrefix}-message`}
          required
          maxLength={2000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-email`} className="block text-sm font-medium">
          Email <span className="font-normal text-muted">(optional — only if you want a reply)</span>
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      {status === "error" && (
        <p className="text-sm text-danger" role="alert">
          Something went wrong sending your feedback. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting" || message.trim().length === 0}
        className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
