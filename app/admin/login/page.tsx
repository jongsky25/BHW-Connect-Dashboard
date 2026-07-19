"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseAuthBrowserClient } from "@/lib/db/supabase-auth-browser";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");

    const supabase = createSupabaseAuthBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin sign in</h1>
        <p className="mt-1 text-sm text-muted">BHW Connect staff only.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="admin-email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="admin-password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        {status === "error" && (
          <p className="text-sm text-danger" role="alert">
            Couldn&apos;t sign in with that email and password.
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {status === "submitting" ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
