import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublishedFormBySlug } from '@/features/forms/queries'
import { estimatePrice, formatMoney } from '@/features/form-engine/estimate'
import FormRunner from './FormRunner'

/**
 * Public enrollment form (spec §5 — Form Engine; plan Task 6.2).
 *
 * Server component: loads the PUBLISHED form + ordered fields + bound product
 * via the service-role client and renders the field definitions server-side (no
 * client round-trip for field config, per spec §3). Missing or draft forms
 * 404. The interactive one-at-a-time UX lives in the client `<FormRunner>`.
 */
export const dynamic = 'force-dynamic'

/**
 * Whether the Altcha proof-of-work widget is shown + enforced. Gated on the
 * public flag (`NEXT_PUBLIC_*`, inlined at build) so it toggles without a site
 * key; ingest enforces the same flag server-side. The HMAC secret stays
 * server-only — the widget needs only the challenge URL.
 */
const CAPTCHA_ENABLED = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED === 'true'

/** Relative ingest endpoint the FormRunner POSTs to (Workstream 7). */
const INGEST_URL = '/api/ingest'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const loaded = await getPublishedFormBySlug(slug)
  if (!loaded) return { title: 'Form not found' }
  return {
    title: loaded.product?.name ?? loaded.form.name,
    description: loaded.form.welcome_message ?? undefined,
  }
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const loaded = await getPublishedFormBySlug(slug)

  if (!loaded) notFound()
  const { form, fields, product } = loaded

  const estimate = product && !form.hide_price ? estimatePrice(product) : null

  return (
    <main className="flex min-h-screen flex-col">
      {/* Persistent product header + live cost estimate. */}
      <header className="border-b border-line bg-surface/60 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Enrollment
            </p>
            <h1 className="mt-0.5 truncate text-base font-bold tracking-[-0.01em]">
              {product?.name ?? form.name}
            </h1>
          </div>
          {estimate ? (
            <div className="flex-shrink-0 text-right">
              <div className="tabular-nums text-lg font-extrabold tracking-[-0.01em]">
                {formatMoney(estimate.total, estimate.currency)}
              </div>
              <div className="text-xs text-dim">
                {estimate.gstRate > 0
                  ? `incl. ${estimate.gstRate}% GST`
                  : 'no GST'}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <FormRunner
        formId={form.id}
        fields={fields}
        welcomeMessage={form.welcome_message}
        submitLabel={form.submit_label ?? 'Submit'}
        captchaEnabled={CAPTCHA_ENABLED}
        ingestUrl={INGEST_URL}
      />
    </main>
  )
}
