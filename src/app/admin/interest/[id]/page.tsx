import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getDealStageHistory,
  getDealTimeline,
} from '@/features/records/queries'
import { getActivityTimeline } from '@/features/crm/activities/service'
import { listStages } from '@/features/crm/stages/queries'
import { formatMoney } from '@/features/form-engine/estimate'
import PaymentStatusChip from '@/features/records/PaymentStatusChip'
import ActivityTimeline from '@/features/crm/ActivityTimeline'
import { requireModuleView } from '@/features/rbac/guard'
import { can } from '@/features/rbac/can'
import { listAssignableUsers } from '@/features/rbac/queries'
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import { CustomFieldsCard } from '@/features/crm/custom-fields/CustomFieldsCard'
import { getConversation } from '@/features/messages/queries'
import ConversationThread from '@/features/messages/ConversationThread'
import StageControl from './StageControl'
import AssignControl from './AssignControl'
import type { NotificationLog } from '@/lib/supabase/types'

/**
 * Deal detail (spec §10 — Deal detail; plan Task 11.1 Step 3). Server
 * component: loads the full timeline (lead → contact → deal → payment fields →
 * notification_log rows) through the service-role client. 404s for an unknown
 * or malformed deal id.
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

/** A labelled key/value row inside a detail card. */
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

/** Section wrapper card with a heading. */
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
      <dl>{children}</dl>
    </section>
  )
}

function NotificationTone({ status }: { status: NotificationLog['status'] }) {
  const tone =
    status === 'sent'
      ? 'text-green'
      : status === 'failed'
        ? 'text-red'
        : 'text-dim'
  return (
    <span className={['text-xs font-medium', tone].join(' ')}>
      {status ?? 'pending'}
    </span>
  )
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireModuleView('deals')
  const { id } = await params
  const timeline = await getDealTimeline(id, ctx)
  if (!timeline) notFound()

  const { deal, lead, contact, product, notifications } = timeline
  const currency = product?.currency ?? 'INR'

  const [stages, stageHistory, activity, customFieldDefs] = await Promise.all([
    listStages(),
    getDealStageHistory(deal.id),
    getActivityTimeline('deal', deal.id),
    getActiveCustomFieldDefs('deal'),
  ])

  // Manual reassignment is offered only to roles that can edit deals.
  const canEdit = can(ctx.permissions, 'deals', 'edit')
  const assignableUsers = canEdit ? await listAssignableUsers() : []

  // Read-only WhatsApp conversation, matched by the resolved contact / phone.
  const messages = await getConversation({
    contactId: contact?.id ?? null,
    whatsappNumber: contact?.whatsapp_number ?? null,
  })

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-6">
        <Link
          href="/admin/interest"
          className="text-sm font-medium text-dim transition-colors hover:text-text"
        >
          ← Interests
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
              {product?.name ?? 'Interest'}
            </h1>
            <p className="mt-1 text-sm text-dim">
              {contact?.name ?? lead?.name ?? 'Unknown customer'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PaymentStatusChip status={deal.payment_status} />
            <Link
              href={`/admin/interest/${deal.id}/edit`}
              className="rounded-[8px] border border-line bg-surface px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface2"
            >
              Edit
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Lead">
          <Row label="Name">{lead?.name ?? '—'}</Row>
          <Row label="Email">{lead?.email ?? '—'}</Row>
          <Row label="Phone" mono>
            {lead?.phone ?? '—'}
          </Row>
          <Row label="State">{lead?.state ?? '—'}</Row>
          <Row label="Source">{lead?.source ?? '—'}</Row>
          <Row label="Status">{lead?.status ?? '—'}</Row>
          <Row label="Submitted">{formatDateTime(lead?.created_at ?? null)}</Row>
        </Card>

        <Card title="Contact">
          <Row label="Name">{contact?.name ?? '—'}</Row>
          <Row label="WhatsApp" mono>
            {contact?.whatsapp_number ?? '—'}
          </Row>
          <Row label="Email">{contact?.email ?? '—'}</Row>
          <Row label="Marketing consent">
            {contact?.marketing_consent ? 'Yes' : 'No'}
          </Row>
          <Row label="Consent at">
            {formatDateTime(contact?.consent_timestamp ?? null)}
          </Row>
        </Card>

        <Card title="Interest">
          <Row label="Base amount" mono>
            {formatMoney(deal.base_amount, currency)}
          </Row>
          <Row label="Taxable amount" mono>
            {formatMoney(deal.taxable_amount, currency)}
          </Row>
          <Row label="CGST" mono>
            {formatMoney(deal.cgst ?? 0, currency)}
          </Row>
          <Row label="SGST" mono>
            {formatMoney(deal.sgst ?? 0, currency)}
          </Row>
          <Row label="IGST" mono>
            {formatMoney(deal.igst ?? 0, currency)}
          </Row>
          <Row label="Total" mono>
            {formatMoney(deal.total_amount, currency)}
          </Row>
          <Row label="Place of supply">{deal.place_of_supply ?? '—'}</Row>
          <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
            <dt className="text-sm text-dim">Stage</dt>
            <dd>
              <StageControl
                dealId={deal.id}
                currentStageId={deal.stage_id}
                stages={stages}
              />
            </dd>
          </div>
          {canEdit ? (
            <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
              <dt className="text-sm text-dim">Assign</dt>
              <dd>
                <AssignControl
                  dealId={deal.id}
                  currentOwnerId={deal.owner_id}
                  users={assignableUsers}
                />
              </dd>
            </div>
          ) : null}
        </Card>

        <Card title="Payment">
          <Row label="Status">
            <PaymentStatusChip status={deal.payment_status} />
          </Row>
          <Row label="Razorpay link id" mono>
            {deal.razorpay_payment_link_id ?? '—'}
          </Row>
          <Row label="Payment link">
            {deal.razorpay_payment_link_url ? (
              <a
                href={deal.razorpay_payment_link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent transition-opacity hover:opacity-80"
              >
                Open link
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Razorpay ref" mono>
            {deal.razorpay_ref ?? '—'}
          </Row>
          <Row label="Created">{formatDateTime(deal.created_at)}</Row>
          <Row label="Updated">{formatDateTime(deal.updated_at)}</Row>
        </Card>

        <CustomFieldsCard defs={customFieldDefs} values={deal.custom_fields} />
      </div>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Notifications
        </h2>
        {notifications.length === 0 ? (
          <p className="text-sm text-dim">No notifications sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
              >
                <div>
                  <div className="text-sm font-medium text-text">
                    {n.template}
                  </div>
                  <div className="text-xs text-faint">
                    {n.channel ?? 'whatsapp'}
                    {n.error_message ? ` · ${n.error_message}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <NotificationTone status={n.status} />
                  <span className="tabular-nums text-xs text-dim">
                    {formatDateTime(n.sent_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          Stage history
        </h2>
        {stageHistory.length === 0 ? (
          <p className="text-sm text-dim">No stage changes recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stageHistory.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
              >
                <div>
                  <div className="text-sm font-medium text-text">
                    {event.stage_name ?? '—'}
                  </div>
                  <div className="text-xs text-faint">
                    {event.actor_email ?? 'System'}
                  </div>
                </div>
                <span className="tabular-nums text-xs text-dim">
                  {formatDateTime(event.entered_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <ActivityTimeline entityType="deal" entityId={deal.id} items={activity} />
      </section>

      <section className="mt-4 rounded-[12px] border border-line bg-surface p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          WhatsApp
        </h2>
        <ConversationThread messages={messages} />
      </section>
    </div>
  )
}
