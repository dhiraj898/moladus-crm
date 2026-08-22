import type { PaymentStatus } from '@/lib/supabase/types'

/**
 * Payment-status chip shared by the deals list and deal detail screens. Pure
 * presentational server component; colours come from design-system tokens.
 */

const LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  link_sent: 'Link sent',
  link_expired: 'Link expired',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
}

/** Token-mapped dot + text colour per status. */
const TONE: Record<PaymentStatus, { dot: string; text: string }> = {
  pending: { dot: 'bg-faint', text: 'text-dim' },
  link_sent: { dot: 'bg-amber', text: 'text-amber' },
  link_expired: { dot: 'bg-faint', text: 'text-dim' },
  paid: { dot: 'bg-green', text: 'text-green' },
  failed: { dot: 'bg-red', text: 'text-red' },
  refunded: { dot: 'bg-faint', text: 'text-dim' },
}

export default function PaymentStatusChip({
  status,
}: {
  status: PaymentStatus | null
}) {
  const key: PaymentStatus = status ?? 'pending'
  const tone = TONE[key]
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full bg-chip-bg px-2.5 py-1 text-xs font-medium',
        tone.text,
      ].join(' ')}
    >
      <span aria-hidden className={['h-1.5 w-1.5 rounded-full', tone.dot].join(' ')} />
      {LABELS[key]}
    </span>
  )
}
