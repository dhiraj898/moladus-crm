'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  WEBHOOK_EVENTS,
  EVENT_LABELS,
  type WebhookEvent,
} from '@/features/webhooks/events'
import {
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  rotateSecret,
} from '@/features/webhooks/actions'
import type {
  EndpointListItem,
  DeliveryListItem,
} from '@/features/webhooks/queries'
import type { WebhookDeliveryStatus } from '@/lib/supabase/types'

/**
 * Webhooks editor (Spec B, plan WS4 Task 6). Lists registered endpoints (URL,
 * subscribed-event chips, active toggle, delete), an Add-endpoint form (URL +
 * event checkboxes), and a per-endpoint Recent deliveries panel (event, status,
 * attempts, response code, time). Creating an endpoint or rotating its secret
 * surfaces the plaintext signing secret ONCE in a copyable callout — it is never
 * shown again.
 *
 * SECURITY: the signing secret only ever reaches this component inside a
 * create/rotate action result and is held in transient local state for the
 * one-time callout; it is never part of the endpoint list data and is cleared
 * when the callout is dismissed.
 */

const inputClass =
  'w-full rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

const primaryBtn =
  'rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'

const ghostBtn =
  'rounded-[8px] border border-line bg-surface2 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40'

const dangerBtn =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm font-semibold text-red transition-colors hover:border-red disabled:cursor-not-allowed disabled:opacity-40'

export default function WebhooksEditor({
  endpoints,
  deliveriesByEndpoint,
}: {
  endpoints: EndpointListItem[]
  deliveriesByEndpoint: Record<string, DeliveryListItem[]>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Which single control is mid-flight, so only its button shows a busy label.
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Add-endpoint form state.
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  // The one-time secret callout: { secret, context } shown after create/rotate.
  const [revealedSecret, setRevealedSecret] = useState<{
    secret: string
    label: string
  } | null>(null)

  // Per-endpoint inline error.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  function toggleFormEvent(event: WebhookEvent) {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    )
  }

  function handleCreate() {
    setFormError(null)
    const trimmed = url.trim()
    if (!trimmed) {
      setFormError('Enter a valid URL (including https://).')
      return
    }
    if (selectedEvents.length === 0) {
      setFormError('Select at least one event.')
      return
    }
    setPendingId('create')
    startTransition(async () => {
      const result = await createEndpoint({ url: trimmed, events: selectedEvents })
      setPendingId(null)
      if (!result.ok) {
        const fieldError =
          result.fieldErrors?.url?.[0] ?? result.fieldErrors?.events?.[0]
        setFormError(fieldError ?? result.error)
        return
      }
      setUrl('')
      setSelectedEvents([])
      setRevealedSecret({
        secret: result.data.secret,
        label: 'Endpoint created — copy the signing secret now.',
      })
      router.refresh()
    })
  }

  function handleToggleActive(ep: EndpointListItem) {
    setRowErrors((prev) => ({ ...prev, [ep.id]: '' }))
    setPendingId(`active:${ep.id}`)
    startTransition(async () => {
      const result = await updateEndpoint(ep.id, { active: !ep.active })
      setPendingId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [ep.id]: result.error }))
        return
      }
      router.refresh()
    })
  }

  function handleToggleEvent(ep: EndpointListItem, event: WebhookEvent) {
    const next = ep.events.includes(event)
      ? ep.events.filter((e) => e !== event)
      : [...ep.events, event]
    if (next.length === 0) {
      setRowErrors((prev) => ({
        ...prev,
        [ep.id]: 'An endpoint must keep at least one event.',
      }))
      return
    }
    setRowErrors((prev) => ({ ...prev, [ep.id]: '' }))
    setPendingId(`event:${ep.id}:${event}`)
    startTransition(async () => {
      const result = await updateEndpoint(ep.id, { events: next })
      setPendingId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [ep.id]: result.error }))
        return
      }
      router.refresh()
    })
  }

  function handleDelete(ep: EndpointListItem) {
    if (
      !window.confirm(
        `Delete this endpoint?\n\n${ep.url}\n\nThis removes it and its delivery history permanently.`
      )
    ) {
      return
    }
    setRowErrors((prev) => ({ ...prev, [ep.id]: '' }))
    setPendingId(`delete:${ep.id}`)
    startTransition(async () => {
      const result = await deleteEndpoint(ep.id)
      setPendingId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [ep.id]: result.error }))
        return
      }
      router.refresh()
    })
  }

  function handleRotate(ep: EndpointListItem) {
    if (
      !window.confirm(
        'Rotate the signing secret?\n\nThe current secret stops working immediately — update the receiver with the new value.'
      )
    ) {
      return
    }
    setRowErrors((prev) => ({ ...prev, [ep.id]: '' }))
    setPendingId(`rotate:${ep.id}`)
    startTransition(async () => {
      const result = await rotateSecret(ep.id)
      setPendingId(null)
      if (!result.ok) {
        setRowErrors((prev) => ({ ...prev, [ep.id]: result.error }))
        return
      }
      setRevealedSecret({
        secret: result.data.secret,
        label: 'Secret rotated — copy the new signing secret now.',
      })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Webhooks</h2>
        <p className="mt-1 text-sm text-dim">
          Register external URLs to receive CRM events. Each delivery is an
          HMAC-SHA256–signed POST (header{' '}
          <code className="text-text">X-Moladus-Signature</code>) sent by the
          scheduler with retry and backoff. The signing secret is generated
          server-side and shown only once — store it when it appears.
        </p>
      </div>

      {revealedSecret ? (
        <SecretCallout
          secret={revealedSecret.secret}
          label={revealedSecret.label}
          onDismiss={() => setRevealedSecret(null)}
        />
      ) : null}

      {/* Add endpoint */}
      <section className="flex flex-col gap-5 rounded-[12px] border border-line bg-surface p-5">
        <div>
          <h3 className="text-base font-bold tracking-[-0.01em]">Add endpoint</h3>
          <p className="mt-1 text-sm text-dim">
            The URL that will receive the signed POST, and the events it
            subscribes to.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="wh-url" className={labelClass}>
            Endpoint URL
          </label>
          <input
            id="wh-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/moladus"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>Events</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((event) => (
              <label
                key={event}
                className="flex cursor-pointer items-center gap-2.5 rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text transition-colors hover:border-accent"
              >
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(event)}
                  onChange={() => toggleFormEvent(event)}
                  className="h-4 w-4 accent-accent"
                />
                <span>{EVENT_LABELS[event]}</span>
                <code className="ml-auto text-xs text-faint">{event}</code>
              </label>
            ))}
          </div>
        </fieldset>

        {formError ? (
          <p role="alert" className="text-xs text-red">
            {formError}
          </p>
        ) : null}

        <div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending}
            className={primaryBtn}
          >
            {pendingId === 'create' ? 'Creating…' : 'Create endpoint'}
          </button>
        </div>
      </section>

      {/* Endpoint list */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-bold tracking-[-0.01em]">
          Registered endpoints
        </h3>
        {endpoints.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-line bg-surface p-6 text-center text-sm text-dim">
            No endpoints yet. Add one above to start receiving events.
          </p>
        ) : (
          endpoints.map((ep) => (
            <EndpointCard
              key={ep.id}
              endpoint={ep}
              deliveries={deliveriesByEndpoint[ep.id] ?? []}
              isPending={isPending}
              pendingId={pendingId}
              error={rowErrors[ep.id]}
              onToggleActive={() => handleToggleActive(ep)}
              onToggleEvent={(event) => handleToggleEvent(ep, event)}
              onRotate={() => handleRotate(ep)}
              onDelete={() => handleDelete(ep)}
            />
          ))
        )}
      </section>
    </div>
  )
}

/** One-time copyable secret callout ("save this — shown once"). */
function SecretCallout({
  secret,
  label,
  onDismiss,
}: {
  secret: string
  label: string
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-accent bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-text">{label}</p>
          <p className="mt-1 text-xs text-dim">
            This is the only time the secret is shown. Store it now — it cannot be
            retrieved later (rotate to generate a new one).
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-sm font-medium text-dim transition-colors hover:text-text"
          aria-label="Dismiss"
        >
          Done
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 overflow-x-auto rounded-[8px] border border-line bg-surface2 px-3 py-2 text-xs text-text">
          {secret}
        </code>
        <button type="button" onClick={copy} className={ghostBtn}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

/** One endpoint card: header, event chips/checkboxes, deliveries, controls. */
function EndpointCard({
  endpoint,
  deliveries,
  isPending,
  pendingId,
  error,
  onToggleActive,
  onToggleEvent,
  onRotate,
  onDelete,
}: {
  endpoint: EndpointListItem
  deliveries: DeliveryListItem[]
  isPending: boolean
  pendingId: string | null
  error: string | undefined
  onToggleActive: () => void
  onToggleEvent: (event: WebhookEvent) => void
  onRotate: () => void
  onDelete: () => void
}) {
  const [showEvents, setShowEvents] = useState(false)

  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <code className="block overflow-x-auto text-sm text-text">
            {endpoint.url}
          </code>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {endpoint.events.map((event) => (
              <span
                key={event}
                className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-dim"
              >
                {EVENT_LABELS[event as WebhookEvent] ?? event}
              </span>
            ))}
          </div>
        </div>
        <ActiveChip active={endpoint.active} />
      </div>

      {/* Edit subscribed events */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowEvents((s) => !s)}
          className="self-start text-xs font-semibold uppercase tracking-[0.12em] text-dim transition-colors hover:text-text"
        >
          {showEvents ? 'Hide events' : 'Edit events'}
        </button>
        {showEvents ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENTS.map((event) => {
              const checked = endpoint.events.includes(event)
              const busy = pendingId === `event:${endpoint.id}:${event}`
              return (
                <label
                  key={event}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text transition-colors hover:border-accent"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPending}
                    onChange={() => onToggleEvent(event)}
                    className="h-4 w-4 accent-accent"
                  />
                  <span>{EVENT_LABELS[event]}</span>
                  {busy ? (
                    <span className="ml-auto text-xs text-faint">Saving…</span>
                  ) : null}
                </label>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* Recent deliveries */}
      <DeliveriesPanel deliveries={deliveries} />

      {error ? (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      ) : null}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onToggleActive}
          disabled={isPending}
          className={ghostBtn}
        >
          {pendingId === `active:${endpoint.id}`
            ? 'Saving…'
            : endpoint.active
              ? 'Deactivate'
              : 'Activate'}
        </button>
        <button
          type="button"
          onClick={onRotate}
          disabled={isPending}
          className={ghostBtn}
        >
          {pendingId === `rotate:${endpoint.id}`
            ? 'Rotating…'
            : 'Rotate secret'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending}
          className={dangerBtn}
        >
          {pendingId === `delete:${endpoint.id}` ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

/** Active / Inactive chip for an endpoint. */
function ActiveChip({ active }: { active: boolean }) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium',
        active ? 'text-green' : 'text-faint',
      ].join(' ')}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

/** Recent-deliveries table for one endpoint. */
function DeliveriesPanel({ deliveries }: { deliveries: DeliveryListItem[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface2 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-dim">
        Recent deliveries
      </p>
      {deliveries.length === 0 ? (
        <p className="text-sm text-dim">No deliveries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="py-1.5 pr-3 font-medium">Event</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Attempts</th>
                <th className="py-1.5 pr-3 font-medium">Code</th>
                <th className="py-1.5 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-2 pr-3 text-text">
                    <code className="text-xs">{d.event}</code>
                  </td>
                  <td className="py-2 pr-3">
                    <DeliveryStatusChip status={d.status} />
                  </td>
                  <td className="py-2 pr-3 text-dim">
                    {d.attempts}/{d.max_attempts}
                  </td>
                  <td className="py-2 pr-3 text-dim">
                    {d.response_code ?? '—'}
                  </td>
                  <td className="py-2 text-dim">
                    {formatTime(d.last_attempt_at ?? d.created_at)}
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

/** Colored chip for a delivery status. */
function DeliveryStatusChip({ status }: { status: WebhookDeliveryStatus }) {
  const tone =
    status === 'delivered'
      ? 'text-green'
      : status === 'failed'
        ? 'text-red'
        : 'text-dim'
  return (
    <span
      className={[
        'inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium',
        tone,
      ].join(' ')}
    >
      {status}
    </span>
  )
}

/** Compact local timestamp. */
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
