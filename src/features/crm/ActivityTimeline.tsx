'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ActivityEntity, ActivityType } from '@/lib/supabase/types'
import { addNote } from '@/features/crm/activities/actions'
import type { ActivityView } from '@/features/crm/activities/service'

/**
 * Shared activity timeline (spec §4.5 / §6). Renders an entity's timeline
 * newest-first with a note composer on top. Notes go through the `addNote`
 * server action; system events (stage_change / created / edited / payment /
 * notification) are rendered read-only from their `type` + `metadata`. All
 * colours come from design tokens; the list is arrow-free with `--line`
 * dividers and `tabular-nums` on any amounts.
 */

const textareaClass =
  'w-full rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-faint focus:border-accent'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/** Label shown for the actor of an event (email, or a system fallback). */
function actorLabel(email: string | null): string {
  return email ?? 'System'
}

/** Short human title for a system (non-note) activity type. */
const TYPE_TITLE: Record<Exclude<ActivityType, 'note'>, string> = {
  stage_change: 'Stage changed',
  created: 'Created',
  edited: 'Edited',
  payment: 'Payment update',
  notification: 'Notification sent',
}

/** Coerce an unknown metadata value to a display string, or null. */
function metaString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

/** Render the body/summary line for a system event from its metadata. */
function SystemDetail({ item }: { item: ActivityView }) {
  if (item.type === 'stage_change') {
    const from = metaString(item.metadata.from) ?? '—'
    const to = metaString(item.metadata.to) ?? '—'
    return (
      <p className="text-sm text-text">
        <span className="text-dim">{from}</span>
        {' → '}
        <span className="font-medium">{to}</span>
      </p>
    )
  }

  if (item.type === 'payment') {
    const status = metaString(item.metadata.status)
    const ref = metaString(item.metadata.razorpay_ref)
    return (
      <p className="text-sm text-text">
        {status ? (
          <span className="font-medium">{status}</span>
        ) : (
          'Payment update'
        )}
        {ref ? <span className="text-dim tabular-nums"> · {ref}</span> : null}
      </p>
    )
  }

  // notification / created / edited (and any future system type): show the
  // stored body if present, otherwise nothing extra beyond the title.
  return item.body ? <p className="text-sm text-text">{item.body}</p> : null
}

function TimelineRow({ item }: { item: ActivityView }) {
  const isNote = item.type === 'note'
  const title = item.type === 'note' ? 'Note' : TYPE_TITLE[item.type]

  return (
    <li className="border-b border-line py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
          {title}
        </span>
        <time className="shrink-0 text-xs text-faint tabular-nums">
          {formatDateTime(item.created_at)}
        </time>
      </div>

      {isNote ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-text">{item.body}</p>
      ) : (
        <div className="mt-2">
          <SystemDetail item={item} />
        </div>
      )}

      <p className="mt-2 text-xs text-dim">{actorLabel(item.actor_email)}</p>
    </li>
  )
}

export default function ActivityTimeline({
  entityType,
  entityId,
  items,
}: {
  entityType: ActivityEntity
  entityId: string
  items: ActivityView[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) {
      setError('A note cannot be empty.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await addNote(entityType, entityId, trimmed)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBody('')
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-bold tracking-[-0.01em]">Activity</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          className={textareaClass}
          aria-label="Add a note"
        />
        {error ? (
          <p
            role="alert"
            className="rounded-[8px] border border-line bg-surface px-3 py-2 text-sm text-red"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium text-text">No activity yet</p>
          <p className="mt-1 text-sm text-dim">
            Notes and system events will appear here, newest first.
          </p>
        </div>
      ) : (
        <ul className="rounded-[12px] border border-line bg-surface px-5">
          {items.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}
