import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'

/**
 * Resolve the authenticated Supabase user from the request cookies, or `null`.
 *
 * Mutating server actions call this to assert an admin session themselves,
 * rather than trusting the middleware path matcher (`/admin/:path*`). Server
 * Actions are dispatched by action id and execute on whichever route receives
 * the POST, so an action id extracted from the client bundle could otherwise be
 * invoked from an unmatched/public route. Because RLS is deny-all and the
 * service-role client is the only DB path, this per-action check is the
 * effective authorization boundary.
 *
 * Uses the anon key and only reads cookies (`getUser()` revalidates the token
 * with Supabase Auth); token-refresh writes are intentionally dropped here —
 * the middleware owns cookie refresh on navigation.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // No-op: this client only reads the session for an auth check.
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user ?? null
}
