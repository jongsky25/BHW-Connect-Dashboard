import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeAuthUser, createSupabaseAuthServerClient } = vi.hoisted(() => {
  const fakeAuthUser = { current: null as { id: string; email: string | null } | null };
  const createSupabaseAuthServerClient = vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: fakeAuthUser.current } }) },
  }));
  return { fakeAuthUser, createSupabaseAuthServerClient };
});
vi.mock("./supabase-auth-server", () => ({ createSupabaseAuthServerClient }));

const { fakeAdminRow, createSupabaseServiceClient } = vi.hoisted(() => {
  const fakeAdminRow = { current: null as { role: string } | null };
  const createSupabaseServiceClient = vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: function () {
          return this;
        },
        maybeSingle: async () => ({ data: fakeAdminRow.current }),
      }),
    }),
  }));
  return { fakeAdminRow, createSupabaseServiceClient };
});
vi.mock("./service-client", () => ({ createSupabaseServiceClient }));

const { getAdminAuthResult, getAdminUser } = await import("./require-admin");

beforeEach(() => {
  fakeAuthUser.current = null;
  fakeAdminRow.current = null;
});

describe("getAdminAuthResult", () => {
  it("reports signed_out when there is no signed-in user", async () => {
    expect(await getAdminAuthResult()).toEqual({ status: "signed_out" });
    expect(await getAdminUser()).toBeNull();
  });

  it("reports not_admin when signed in but not in admin_users", async () => {
    fakeAuthUser.current = { id: "user-1", email: "someone@example.com" };
    expect(await getAdminAuthResult()).toEqual({ status: "not_admin", email: "someone@example.com" });
    expect(await getAdminUser()).toBeNull();
  });

  it("reports ok with the admin user when signed in and present in admin_users", async () => {
    fakeAuthUser.current = { id: "user-1", email: "admin@example.com" };
    fakeAdminRow.current = { role: "admin" };
    expect(await getAdminAuthResult()).toEqual({
      status: "ok",
      admin: { id: "user-1", email: "admin@example.com", role: "admin" },
    });
    expect(await getAdminUser()).toEqual({ id: "user-1", email: "admin@example.com", role: "admin" });
  });

  it("fails closed (signed_out) rather than throwing when the service client is unconfigured", async () => {
    fakeAuthUser.current = { id: "user-1", email: "admin@example.com" };
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    expect(await getAdminAuthResult()).toEqual({ status: "signed_out" });
  });

  it("fails closed (signed_out) rather than throwing when the auth client is unconfigured", async () => {
    createSupabaseAuthServerClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    expect(await getAdminAuthResult()).toEqual({ status: "signed_out" });
  });
});
