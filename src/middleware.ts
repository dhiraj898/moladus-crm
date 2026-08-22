import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware-client'

const LOGIN_PATH = '/admin/login'
const DEFAULT_AUTHED_PATH = '/admin/products'

/**
 * Redirect to `url` while preserving any auth cookies Supabase wrote onto
 * `source` during `getUser()`. Without copying these, a refreshed
 * access/refresh token pair is dropped on the redirect, leaving the browser
 * with a revoked refresh token and causing intermittent sign-outs.
 */
function redirectWithCookies(url: URL, source: NextResponse) {
  const redirect = NextResponse.redirect(url)
  source.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie)
  })
  return redirect
}

/**
 * Protects every `/admin/*` route with Supabase Auth.
 *
 * - Unauthenticated request to any admin route except the login page →
 *   redirect to `/admin/login` (preserving the intended path).
 * - Authenticated request to the login page → redirect to the admin home.
 *
 * `getUser()` (not `getSession()`) is used so the token is revalidated with
 * Supabase Auth on every request rather than trusted from the cookie alone.
 */
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isLoginPage = pathname === LOGIN_PATH

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = LOGIN_PATH
    url.searchParams.set('redirectedFrom', pathname)
    return redirectWithCookies(url, response)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = DEFAULT_AUTHED_PATH
    url.search = ''
    return redirectWithCookies(url, response)
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*'],
}
