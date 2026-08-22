import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

/**
 * Server-only Supabase client built with the service-role key.
 *
 * The service-role key bypasses RLS, so this client MUST NEVER reach the
 * browser bundle. The `import 'server-only'` guard makes any client-side
 * import a build error. All application DB access goes through this client.
 */
export function getServiceClient() {
  const env = getEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
