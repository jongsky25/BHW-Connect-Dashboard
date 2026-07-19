import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeResult, createSupabaseServiceClient } = vi.hoisted(() => {
  const fakeResult = { current: { count: 0 as number | null, error: null as { message: string } | null } };
  const createSupabaseServiceClient = vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: function () {
          return this;
        },
        gte: async () => fakeResult.current,
      }),
    }),
  }));
  return { fakeResult, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { isChatRateLimited, recordChatMessage } = await import("./rate-limit");

beforeEach(() => {
  fakeResult.current = { count: 0, error: null };
});

describe("isChatRateLimited", () => {
  it("is not limited under the threshold", async () => {
    fakeResult.current = { count: 5, error: null };
    expect(await isChatRateLimited("session-1")).toBe(false);
  });

  it("is limited at or above the threshold", async () => {
    fakeResult.current = { count: 20, error: null };
    expect(await isChatRateLimited("session-1")).toBe(true);
  });

  it("fails open (not limited) on a read error", async () => {
    fakeResult.current = { count: null, error: { message: "boom" } };
    expect(await isChatRateLimited("session-1")).toBe(false);
  });

  it("fails open rather than throwing when the service client itself is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    });
    expect(await isChatRateLimited("session-1")).toBe(false);
  });
});

describe("recordChatMessage", () => {
  it("does not throw when the service client is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    await expect(recordChatMessage("session-1", "PH")).resolves.toBeUndefined();
  });
});
