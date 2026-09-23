'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AssignableUser } from '@/features/rbac/queries'
import { assignDeal } from '@/features/rbac/actions'

/**
 * Manual assignment control for the deal detail page (spec §9.2 / plan Task
 * 6.4). Rendered only when the current user has `deals.edit`. A labelled select
 * of assignable users (plus an "Unassigned" option → `null`) that calls
 * `assignDeal` inside a transition and surfaces `ActionResult` errors inline.
 * Own-scope callers are re-checked server-side, so a forged id cannot reassign a
 * record the caller cannot see.
 */

const UNASSIGNED = ''

export default function AssignControl({
  dealId,
  currentOwnerId,
  users,
}: {
  dealId: string
  currentOwnerId: string | null
  users: AssignableUser[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(currentOwnerId ?? UNASSIGNED)
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    const previous = value
    if (next === previous) return

    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await assignDeal(dealId, next === UNASSIGNED ? null : next)
      if (!result.ok) {
        setValue(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={value}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Assign deal"
        className="rounded-[8px] border border-line bg-bg px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value={UNASSIGNED}>Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.email ?? user.id}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-red">
          {error}
        </span>
      ) : null}
    </div>
  )
}
