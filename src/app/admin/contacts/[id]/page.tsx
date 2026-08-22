import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getContactDetail, type LinkedDeal } from '@/features/records/queries'
import { getActivityTimeline } from '@/features/crm/activities/service'
import { formatMoney } from '@/features/form-engine/estimate'
import PaymentStatusChip from '@/features/records/PaymentStatusChip'
import ActivityTimeline from '@/features/crm/ActivityTimeline'

/**
 * Contact detail (spec §6 — Contact detail). Server component: loads the
 * contact, its originating lead, its deals (with product + stage names) and
 * activity timeline through the service-role client. Shows marketing consent +
 * timestamp and tags. 404s for an unknown or malformed contact id.
 */
export const dynamic = 'force-dynamic'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

function Row({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-sm text-dim">{label}</dt>
      <dd
        className={[
          'text-right text-sm font-medium text-text',
          mono ? 'tabular-nums' : '',
        ].join(' ')}
      >
        {children}
      </dd>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[12px] border border-line bg-surface p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Render the linked-deals list for the contact detail page. */
function LinkedDealsCard({ deals }: { deals: LinkedDeal[] }) {
  return (
    <Card title="Deals">
      {deals.length === 0 ? (
        <p className="text-sm text-dim">No deals linked yet.</p>
      ) : (
        <ul className="flex flex-col">
          {deals.map((deal) => (
            <li
              key={deal.id}
              className="border-b border-line py-2.5 last:border-b-0"
            >
              <Link
                href={`/admin/deals/${deal.id}`}
                className="flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-text">
                    {deal.product_name ?? 'Deal'}
                  </div>
                  <div className="text-xs text-dim">
                    {deal.stage_name ?? '—'} · {formatDateTime(deal.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-text">
                    {formatMoney(deal.total_amount, 'INR')}
                  </span>
                  <PaymentStatusChip status={deal.payment_status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getContactDetail(id)
  if (!detail) notFound()

  const { contact, lead, deals } = detail
  const activity = await getActivityTimeline('contact', contact.id)
  const tags = contact.tags ?? []

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-6">
        <Link
          href="/admin/contacts"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Contacts
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
              {contact.name ?? 'Contact'}
            </h1>
            <p className="mt-1 text-sm tabular-nums text-dim">
              {contact.whatsapp_number}
            </p>
          </div>
          <Link
            href={`/admin/contacts/${contact.id}/edit`}
            className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface2"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Contact">
          <dl>
            <Row label="Name">{contact.name ?? '—'}</Row>
            <Row label="WhatsApp" mono>
              {contact.whatsapp_number}
            </Row>
            <Row label="Email">{contact.email ?? '—'}</Row>
            <Row label="Marketing consent">
              {contact.marketing_consent ? 'Yes' : 'No'}
            </Row>
            <Row label="Consent at">
              {formatDateTime(contact.consent_timestamp)}
            </Row>
            <Row label="Tags">{tags.length > 0 ? tags.join(', ') : '—'}</Row>
            <Row label="Added">{formatDateTime(contact.created_at)}</Row>
          </dl>
        </Card>

        <Card title="Lead">
          {lead ? (
            <dl>
              <Row label="Name">
                <Link
                  href={`/admin/leads/${lead.id}`}
                  className="text-accent transition-opacity hover:opacity-80"
                >
                  {lead.name ?? 'View lead'}
                </Link>
              </Row>
              <Row label="Email">{lead.email ?? '—'}</Row>
              <Row label="Phone" mono>
                {lead.phone ?? '—'}
              </Row>
              <Row label="Source">{lead.source ?? '—'}</Row>
              <Row label="Status">{lead.status ?? 'new'}</Row>
            </dl>
          ) : (
            <p className="text-sm text-dim">
              No originating lead linked to this contact.
            </p>
          )}
        </Card>

        <LinkedDealsCard deals={deals} />
      </div>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <ActivityTimeline
          entityType="contact"
          entityId={contact.id}
          items={activity}
        />
      </section>
    </div>
  )
}
