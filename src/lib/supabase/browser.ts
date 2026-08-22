import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client, used ONLY by the admin login form to call
 * `auth.signInWithPassword` / `auth.signOut`. It uses the public URL + anon
 * key (both `NEXT_PUBLIC_*`, safe to ship to the browser). The anon key never
 * gates data access — every table is RLS deny-all — so this client can read
 * nothing beyond the caller's own auth session cookie.
 *
 * All application data access happens server-side via `getServiceClient()`.
 */
export function getBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
