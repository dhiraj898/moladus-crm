'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Confirm-then-delete button for an entity's edit page. Takes a bound server
 * action (e.g. `deleteProduct.bind(null, id)`); on success redirects to the
 * list, on failure shows the action's error inline (e.g. "still in use").
 */
export default function DeleteButton({
  action,
  redirectTo,
  confirm,
  label = 'Delete',
}: {
  action: () => Promise<Result>
  redirectTo: string
  confirm: string
  label?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (!window.confirm(confirm)) return
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(redirectTo)
      router.refresh()
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded-[8px] border border-line px-4 py-2.5 text-[15px] font-medium text-red transition-colors hover:border-red disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Deleting…' : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red">
          {error}
        </p>
      ) : null}
    </div>
  )
}
