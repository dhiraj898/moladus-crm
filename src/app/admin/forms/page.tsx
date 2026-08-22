import Link from 'next/link'
import { listForms } from '@/features/forms/queries'
import CopyLinkButton from '@/features/forms/CopyLinkButton'

/**
 * Form list (spec §10 — Forms list). Server component: reads forms with their
 * bound product via the service-role client and renders a design-system table
 * with a copy-link action for published forms.
 */
export const dynamic = 'force-dynamic'

/** Public base URL for form links; empty string keeps links relative. */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

function StatusChip({ status }: { status: string }) {
  const published = status === 'published'
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium',
        published ? 'text-green' : 'text-dim',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'h-1.5 w-1.5 rounded-full',
          published ? 'bg-green' : 'bg-faint',
        ].join(' ')}
      />
      {published ? 'Published' : 'Draft'}
    </span>
  )
}

export default async function FormsPage() {
  const forms = await listForms()

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Forms</h1>
          <p className="mt-1 text-sm text-dim">
            Product-linked enrollment forms and their public links.
          </p>
        </div>
        <Link
          href="/admin/forms/new"
          className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          New form
        </Link>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">No forms yet</p>
          <p className="mt-1 text-sm text-dim">
            Create your first enrollment form and link it to a product.
          </p>
          <Link
            href="/admin/forms/new"
            className="mt-5 inline-block rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            New form
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Name</th>
                <th className="px-4 py-3 font-semibold text-dim">Product</th>
                <th className="px-4 py-3 font-semibold text-dim">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => (
                <tr
                  key={form.id}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/forms/${form.id}`}
                      className="font-medium text-text transition-colors hover:text-accent"
                    >
                      {form.name}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-dim">
                      /f/{form.slug}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-dim">
                    {form.product?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={form.status ?? 'draft'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {form.status === 'published' ? (
                        <CopyLinkButton url={`${APP_URL}/f/${form.slug}`} />
                      ) : null}
                      <Link
                        href={`/admin/forms/${form.id}`}
                        className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
                      >
                        Edit
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
