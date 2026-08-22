import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import AdminNav from './AdminNav'
import SignOutButton from './SignOutButton'

/**
 * Read the current admin user inside a Server Component.
 *
 * Uses the anon key + request cookies. Cookie writes (token refresh) are not
 * permitted in a Server Component render, so `setAll` is a no-op here — the
 * middleware owns cookie refresh on every `/admin/*` request.
 */
async function getUser() {
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
          // No-op: cookies are read-only in a Server Component render.
        },
      },
    }
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()

  // The middleware only lets unauthenticated requests reach `/admin/login`,
  // so no user here means the login page — render it without the admin shell.
  if (!user) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-[240px] flex-shrink-0 flex-col justify-between border-r border-line bg-bg px-4 py-6">
        <div>
          <div className="px-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Moladus
            </p>
            <p className="mt-1 text-sm font-semibold text-text">Admin</p>
          </div>
          <div className="mt-6">
            <AdminNav />
          </div>
        </div>

        <div className="flex flex-col gap-3 px-1">
          <p className="truncate px-2 text-xs text-faint" title={user.email ?? ''}>
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  )
}
