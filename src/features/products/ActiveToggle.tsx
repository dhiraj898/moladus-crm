'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setProductActive } from './actions'

/**
 * Inline active/inactive switch for a product row on the list screen.
 * Renders as a status chip that flips the `active` flag via the server action.
 */
export default function ActiveToggle({
  id,
  active,
}: {
  id: string
  active: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)

  function toggle() {
    setError(false)
    startTransition(async () => {
      const result = await setProductActive(id, !active)
      if (!result.ok) {
        setError(true)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={active}
      title={error ? 'Update failed — click to retry' : 'Toggle active'}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60',
        error
          ? 'bg-chip-bg text-red'
          : active
            ? 'bg-chip-bg text-green'
            : 'bg-chip-bg text-dim',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'h-1.5 w-1.5 rounded-full',
          error ? 'bg-red' : active ? 'bg-green' : 'bg-faint',
        ].join(' ')}
      />
      {error ? 'Retry' : active ? 'Active' : 'Inactive'}
    </button>
  )
}
