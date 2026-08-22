import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLeadDetail, type LinkedDeal } from '@/features/records/queries'
import { getActivityTimeline } from '@/features/crm/activities/service'
import { formatMoney } from '@/features/form-engine/estimate'
import PaymentStatusChip from '@/features/records/PaymentStatusChip'
import ActivityTimeline from '@/features/crm/ActivityTimeline'

/**
 * Lead detail (spec §6 — Lead detail). Server component: loads the lead, its
 * linked contact, its deals (with product + stage names), its owner email and
 * activity timeline through the service-role client. Shows the raw form payload
 * and UTM data for provenance. 404s for an unknown or malformed lead id.
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

/** Render the linked-deals list for the lead detail page. */
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

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getLeadDetail(id)
  if (!detail) notFound()

  const { lead, owner_email, contact, deals } = detail
  const activity = await getActivityTimeline('lead', lead.id)

  const utm = lead.utm && typeof lead.utm === 'object' ? lead.utm : null

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-6">
        <Link
          href="/admin/leads"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Leads
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
              {lead.name ?? 'Lead'}
            </h1>
            <p className="mt-1 text-sm text-dim">
              {lead.email ?? lead.phone ?? 'No contact details'}
            </p>
          </div>
          <Link
            href={`/admin/leads/${lead.id}/edit`}
            className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface2"
          >
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Lead">
          <dl>
            <Row label="Name">{lead.name ?? '—'}</Row>
            <Row label="Email">{lead.email ?? '—'}</Row>
            <Row label="Phone" mono>
              {lead.phone ?? '—'}
            </Row>
            <Row label="State">{lead.state ?? '—'}</Row>
            <Row label="Source">{lead.source ?? '—'}</Row>
            <Row label="Status">{lead.status ?? 'new'}</Row>
            <Row label="Owner">{owner_email ?? '—'}</Row>
            <Row label="Submitted">{formatDateTime(lead.created_at)}</Row>
          </dl>
        </Card>

        <Card title="Contact">
          {contact ? (
            <dl>
              <Row label="Name">
                <Link
                  href={`/admin/contacts/${contact.id}`}
                  className="text-accent transition-opacity hover:opacity-80"
                >
                  {contact.name ?? 'View contact'}
                </Link>
              </Row>
              <Row label="WhatsApp" mono>
                {contact.whatsapp_number}
              </Row>
              <Row label="Email">{contact.email ?? '—'}</Row>
              <Row label="Marketing consent">
                {contact.marketing_consent ? 'Yes' : 'No'}
              </Row>
            </dl>
          ) : (
            <p className="text-sm text-dim">No contact linked to this lead.</p>
          )}
        </Card>

        <LinkedDealsCard deals={deals} />

        <Card title="UTM">
          {utm && Object.keys(utm).length > 0 ? (
            <dl>
              {Object.entries(utm).map(([key, value]) => (
                <Row key={key} label={key}>
                  {String(value)}
                </Row>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-dim">No UTM data.</p>
          )}
        </Card>
      </div>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Raw payload
        </h2>
        <pre className="overflow-x-auto rounded-[8px] border border-line bg-bg p-4 text-xs text-dim">
          {JSON.stringify(lead.raw_payload ?? {}, null, 2)}
        </pre>
      </section>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <ActivityTimeline entityType="lead" entityId={lead.id} items={activity} />
      </section>
    </div>
  )
}
