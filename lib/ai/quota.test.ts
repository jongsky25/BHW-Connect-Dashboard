import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRateLimitedError, ProviderUnavailableError } from "./providers/types";

type Row = {
  id: number;
  provider: string;
  window_type: string;
  window_start: string;
  request_count: number;
  limit_value: number;
  is_paused: boolean;
  paused_until: string | null;
};

/** Minimal in-memory stand-in for the `ai_provider_quota` table, supporting only the exact
 * select/insert/update chains lib/ai/quota.ts issues. */
function createFakeSupabase(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let nextId = rows.length + 1;

  function from(table: string) {
    if (table !== "ai_provider_quota") throw new Error(`unexpected table: ${table}`);

    return {
      select() {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          async maybeSingle() {
            const match = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as never)[k] === v));
            return { data: match ?? null, error: null };
          },
          async single() {
            const match = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as never)[k] === v));
            return match ? { data: match, error: null } : { data: null, error: { message: "not found" } };
          },
        };
        return builder;
      },
      insert(values: Partial<Row>) {
        return {
          select() {
            return {
              async single() {
                const row: Row = {
                  id: nextId++,
                  provider: values.provider as string,
                  window_type: values.window_type as string,
                  window_start: values.window_start as string,
                  request_count: 0,
                  limit_value: values.limit_value as number,
                  is_paused: false,
                  paused_until: null,
                };
                rows.push(row);
                return { data: row, error: null };
              },
            };
          },
        };
      },
      update(values: Partial<Row>) {
        return {
          eq(_col: string, id: number) {
            const row = rows.find((r) => r.id === id);
            if (row) Object.assign(row, values);
            return Promise.resolve({ data: row ?? null, error: null });
          },
        };
      },
    };
  }

  return { from, rows };
}

const { fakeSupabase, createSupabaseServiceClient } = vi.hoisted(() => {
  const fakeSupabase = { current: null as ReturnType<typeof createFakeSupabase> | null };
  return { fakeSupabase, createSupabaseServiceClient: vi.fn(() => fakeSupabase.current) };
});

vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }));
vi.mock("./providers", () => ({
  getProvider,
  PROVIDER_CASCADE: ["gemini", "groq", "openrouter", "mistral"],
}));

const { checkQuota, completeWithCascade } = await import("./quota");

beforeEach(() => {
  fakeSupabase.current = createFakeSupabase();
  getProvider.mockReset();
});

describe("checkQuota", () => {
  it("is available with no existing rows (lazily seeds them)", async () => {
    const result = await checkQuota("gemini", new Date("2026-07-19T10:00:00Z"));
    expect(result.available).toBe(true);
  });

  it("reports capped_minute once the minute window's limit is hit", async () => {
    const now = new Date("2026-07-19T10:00:30Z");
    fakeSupabase.current = createFakeSupabase([
      {
        id: 1,
        provider: "gemini",
        window_type: "minute",
        window_start: "2026-07-19T10:00:00.000Z",
        request_count: 10,
        limit_value: 10,
        is_paused: false,
        paused_until: null,
      },
    ]);
    const result = await checkQuota("gemini", now);
    expect(result).toEqual({ available: false, reason: "capped_minute" });
  });

  it("reports unavailable rather than throwing when the service client itself is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    });
    const result = await checkQuota("gemini");
    expect(result).toEqual({ available: false, reason: "unavailable" });
  });

  it("reports paused while paused_until is in the future", async () => {
    const now = new Date("2026-07-19T10:00:30Z");
    fakeSupabase.current = createFakeSupabase([
      {
        id: 1,
        provider: "mistral",
        window_type: "day",
        window_start: "2026-07-19T00:00:00.000Z",
        request_count: 0,
        limit_value: 50,
        is_paused: true,
        paused_until: "2026-07-19T10:05:00.000Z",
      },
    ]);
    const result = await checkQuota("mistral", now);
    expect(result).toEqual({ available: false, reason: "paused" });
  });
});

describe("completeWithCascade", () => {
  it("tries providers in fixed cascade order and returns the first success", async () => {
    const attempted: string[] = [];
    getProvider.mockImplementation((id: string) => ({
      id,
      async complete() {
        attempted.push(id);
        if (id !== "openrouter") throw new ProviderUnavailableError(id as never);
        return { content: "answer", toolCalls: [] };
      },
    }));

    const result = await completeWithCascade([], []);
    expect(attempted).toEqual(["gemini", "groq", "openrouter"]);
    expect(result).toEqual({ allCapped: false, provider: "openrouter", completion: { content: "answer", toolCalls: [] } });
  });

  it("skips a provider whose quota is already capped", async () => {
    const now = new Date("2026-07-19T10:00:30Z");
    fakeSupabase.current = createFakeSupabase([
      {
        id: 1,
        provider: "gemini",
        window_type: "minute",
        window_start: "2026-07-19T10:00:00.000Z",
        request_count: 10,
        limit_value: 10,
        is_paused: false,
        paused_until: null,
      },
    ]);
    const attempted: string[] = [];
    getProvider.mockImplementation((id: string) => ({
      id,
      async complete() {
        attempted.push(id);
        return { content: "ok", toolCalls: [] };
      },
    }));

    const result = await completeWithCascade([], [], now);
    expect(attempted).toEqual(["groq"]);
    expect(result.allCapped).toBe(false);
  });

  it("pauses a provider on a live 429 and falls through to the next", async () => {
    const attempted: string[] = [];
    getProvider.mockImplementation((id: string) => ({
      id,
      async complete() {
        attempted.push(id);
        if (id === "gemini") throw new ProviderRateLimitedError("gemini", 30);
        return { content: "ok", toolCalls: [] };
      },
    }));

    const result = await completeWithCascade([], []);
    expect(attempted).toEqual(["gemini", "groq"]);
    expect(result.allCapped).toBe(false);

    const geminiDayRow = fakeSupabase.current!.rows.find((r) => r.provider === "gemini" && r.window_type === "day");
    expect(geminiDayRow?.is_paused).toBe(true);
    expect(geminiDayRow?.paused_until).toBeTruthy();
  });

  it("returns allCapped (not a throw) when the service client itself is unconfigured for the whole run", async () => {
    createSupabaseServiceClient.mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    });
    getProvider.mockImplementation(() => ({ id: "unused", async complete() { return { content: "unreachable", toolCalls: [] }; } }));

    await expect(completeWithCascade([], [])).resolves.toEqual({ allCapped: true, provider: null });
  });

  it("returns allCapped when every provider fails or is unconfigured", async () => {
    getProvider.mockImplementation((id: string) => ({
      id,
      async complete() {
        throw new ProviderUnavailableError(id as never);
      },
    }));

    const result = await completeWithCascade([], []);
    expect(result).toEqual({ allCapped: true, provider: null });
  });
});
