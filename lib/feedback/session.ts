"use client";

// Single source of truth for the anonymized per-tab session id (BUILD_PLAN.md §7 1.9 — no PII,
// just a random UUID). Kept in sessionStorage so it's stable across a visit but resets per tab;
// falls back to a fresh UUID when storage is unavailable (private-browsing edge cases) rather than
// throwing. Shared by usage logging (lib/usage/log-client.ts) and both feedback flows so a single
// visit's events and feedback share one id.
const SESSION_KEY = "bhw-connect-session-id";

export function getSessionId(): string {
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
