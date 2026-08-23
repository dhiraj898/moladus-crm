import type { Message } from '@/lib/supabase/types'

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/** Read-only WhatsApp conversation (Spec 6). Inbound left, outbound right. */
export default function ConversationThread({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="text-sm text-dim">
        No WhatsApp messages captured yet.
        <span className="mt-1 block text-xs text-faint">
          Capture begins only once the AiSensy webhook is live — there is no
          history before that.
        </span>
      </div>
    )
  }

  return (
    <ul className="flex max-h-[520px] flex-col gap-2 overflow-y-auto">
      {messages.map((m) => {
        const outbound = m.direction === 'outbound'
        const isText = !m.message_type || m.message_type === 'text'
        return (
          <li
            key={m.id}
            className={['flex', outbound ? 'justify-end' : 'justify-start'].join(' ')}
          >
            <div
              className={[
                'max-w-[75%] rounded-[12px] border px-3 py-2',
                outbound
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-line bg-surface2',
              ].join(' ')}
            >
              {!isText && (
                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-dim">
                  {m.message_type}
                </div>
              )}
              {m.body ? (
                <div className="whitespace-pre-wrap break-words text-sm text-text">
                  {m.body}
                </div>
              ) : (
                <div className="text-sm italic text-dim">(no text)</div>
              )}
              <div className="mt-1 text-right text-[11px] tabular-nums text-faint">
                {formatDateTime(m.sent_at)}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
