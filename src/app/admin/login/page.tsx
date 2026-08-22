'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabase/browser'

function isAdminPath(path: string | null): path is string {
  // Only allow same-origin admin paths as a post-login redirect target.
  return !!path && path.startsWith('/admin') && !path.startsWith('/admin/login')
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectedFrom = searchParams.get('redirectedFrom')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    const target = isAdminPath(redirectedFrom) ? redirectedFrom : '/admin/products'
    // Full navigation so the middleware re-reads the freshly set auth cookies.
    router.replace(target)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Password
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-[8px] bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[400px] flex-col justify-center px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        Moladus
      </p>
      <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
        Admin sign in
      </h1>
      <p className="mb-8 mt-2 text-sm leading-[1.6] text-dim">
        Accounts are provisioned by an administrator. There is no self-service
        sign-up.
      </p>

      <Suspense
        fallback={<p className="text-sm text-dim">Loading…</p>}
      >
        <LoginForm />
      </Suspense>
    </main>
  )
}
