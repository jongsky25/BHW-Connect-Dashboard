// Test-only stand-in for the `server-only` marker package (see vitest.config.ts) — its real
// implementation throws unconditionally unless resolved through Next.js's build-time
// "react-server" condition, which vitest's plain Node runner doesn't apply.
export {};
