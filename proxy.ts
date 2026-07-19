import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase Auth session cookie on every `/admin` request (required by
 * `@supabase/ssr` for token refresh to work in Server Components, which can't write cookies
 * themselves — see lib/db/supabase-auth-server.ts) and redirects an unauthenticated visitor to
 * `/admin/login`. This is a UX shortcut, not the security boundary: the actual admin_users role
 * check happens server-side in `app/admin/(dashboard)/layout.tsx` via `getAdminAuthResult()`
 * regardless of what this decides, per BUILD_PLAN.md §8 2.5 ("non-admin authenticated user is
 * denied"). Named `proxy.ts` (not `middleware.ts`) per Next.js 16's file convention rename.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/admin/login";
  if (!user && !isLoginPage) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*"],
};
