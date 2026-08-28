import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runScheduledReplay } = vi.hoisted(() => ({ runScheduledReplay: vi.fn() }));

vi.mock("@/lib/ai/regression-schedule", () => ({ runScheduledReplay }));

const { GET } = await import("./route");

/**
 * The cron gate, and the status code's meaning.
 *
 * The gate is the same one `/api/cron/precompute` carries, including the clause that matters most:
 * an unset `CRON_SECRET` refuses rather than opening. `proxy.ts` matches `/admin/:path*` and never
 * sees an `/api/*` request, so this handler is the boundary — and it loops over every open case's
 * tool calls, which is exactly the shape guardrail 4 says must never be reachable unauthenticated.
 *
 * The status code is the second thing under test, and it is a design decision rather than a
 * convention: 200 means the run happened, whatever it found. A run that reports eight moved figures
 * is this job working. Only a run that could not be recorded is a failed invocation, because that
 * is the one nobody will ever see.
 */

const SECRET = "s3cret-cron-token";

/** What the schedule module hands back on a normal run: everything scored, nothing moved. */
function result(over: Record<string, unknown> = {}) {
  return {
    recorded: true,
    runId: 42,
    run: {
      startedAt: "2026-08-29T22:00:00.000Z",
      finishedAt: "2026-08-29T22:00:11.500Z",
      durationMs: 11_500,
      casesOpen: 18,
      casesReplayed: 18,
      ok: 18,
      degraded: 0,
      broken: 0,
      pins: 66,
      pinsMet: 66,
      pinsUnmet: 0,
      pinsUnresolved: 0,
      outcome: "clean",
      findingsDigest: "d41d8cd98f00b204e9800998ecf8427e",
      cases: [],
    },
    ...over,
  };
}

function get(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/regression-replay", { headers });
}

const REAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  runScheduledReplay.mockReset().mockResolvedValue(result());
});

afterEach(() => {
  if (REAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = REAL_SECRET;
});

describe("GET /api/cron/regression-replay — the gate", () => {
  it("refuses an unauthenticated call with 401 and replays nothing", async () => {
    const response = await GET(get());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(runScheduledReplay).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await GET(get({ authorization: "Bearer not-the-secret" }));

    expect(response.status).toBe(401);
    expect(runScheduledReplay).not.toHaveBeenCalled();
  });

  it("refuses a bare token that is the secret but not a Bearer", async () => {
    const response = await GET(get({ authorization: SECRET }));

    expect(response.status).toBe(401);
    expect(runScheduledReplay).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is unset, rather than running open", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(get({ authorization: "Bearer " }));

    expect(response.status).toBe(401);
    expect(runScheduledReplay).not.toHaveBeenCalled();
  });

  it("runs on the right Bearer secret", async () => {
    const response = await GET(get({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(runScheduledReplay).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/cron/regression-replay — what the status code means", () => {
  it("returns 200 with the summary on a clean run", async () => {
    const response = await GET(get({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recorded: true,
      runId: 42,
      outcome: "clean",
      casesReplayed: 18,
      pinsMet: 66,
    });
  });

  it("still returns 200 when the run found eight moved figures — that is the job working", async () => {
    runScheduledReplay.mockResolvedValue(
      result({ run: { ...result().run, outcome: "moved", pinsMet: 58, pinsUnmet: 8 } }),
    );
    const response = await GET(get({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "moved", pinsUnmet: 8 });
  });

  it("keeps the moved and unscorable counts apart in the response body", async () => {
    runScheduledReplay.mockResolvedValue(
      result({
        run: {
          ...result().run,
          outcome: "structural",
          pinsMet: 60,
          pinsUnmet: 2,
          pinsUnresolved: 4,
        },
      }),
    );
    const response = await GET(get({ authorization: `Bearer ${SECRET}` }));

    expect(await response.json()).toMatchObject({ pinsUnmet: 2, pinsUnresolved: 4 });
  });

  it("returns 500 when the run could not be recorded, because nobody would ever see it", async () => {
    runScheduledReplay.mockResolvedValue({
      recorded: false,
      reason: "The replay ran but its result could not be recorded, so nothing was saved.",
      run: result().run,
    });
    const response = await GET(get({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ recorded: false, outcome: "clean" });
  });
});
