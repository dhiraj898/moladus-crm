'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Stage } from '@/lib/supabase/types'
import { changeDealStage } from '@/features/crm/deals/actions'

/**
 * Stage dropdown for the deal detail page (spec §4.2 / §6). Seeded with every
 * configured stage and the deal's current stage selected. Changing the value
 * confirms, calls `changeDealStage`, and refreshes the page so the stage
 * history + activity timeline pick up the new event. Errors surface inline; the
 * control is disabled while the change is in flight.
 */
export default function StageControl({
  dealId,
  currentStageId,
  stages,
}: {
  dealId: string
  currentStageId: string | null
  stages: Stage[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(currentStageId ?? '')
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = e.target.value
    const previous = value
    if (!nextId || nextId === previous) return

    const nextName = stages.find((s) => s.id === nextId)?.name ?? 'this stage'
    if (!window.confirm(`Move this deal to “${nextName}”?`)) return

    setValue(nextId)
    setError(null)
    startTransition(async () => {
      const result = await changeDealStage(dealId, nextId)
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
        disabled={isPending || stages.length === 0}
        aria-label="Interest stage"
        className="rounded-[8px] border border-line bg-bg px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {currentStageId ? null : (
          <option value="" disabled>
            Select a stage…
          </option>
        )}
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
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
