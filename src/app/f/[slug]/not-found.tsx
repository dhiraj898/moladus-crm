import Link from 'next/link'

/**
 * 404 for the public form route (plan Task 6.2). Rendered when a slug has no
 * published form (missing or still in draft).
 */
export default function FormNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        Not available
      </p>
      <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">
        This form isn’t available
      </h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-dim">
        The link may be incorrect, or the form may not be published yet. Please
        double-check the address or contact whoever shared it with you.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-[8px] border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:border-faint"
      >
        Go home
      </Link>
    </main>
  )
}
