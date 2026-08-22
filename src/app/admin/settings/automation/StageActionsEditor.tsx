'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Stage, StageAction, StageActionType } from '@/lib/supabase/types'
import {
  createStageAction,
  updateStageAction,
  reorderStageActions,
  deleteStageAction,
} from '@/features/crm/automation/actions'
import {
  inputClass,
  labelClass,
  addButtonClass,
  linkButtonClass,
  dangerButtonClass,
} from './ui'

/**
 * Stage on-enter actions editor (design §7). For each stage, an ordered list of
 * actions that run when a deal enters it. `move_stage` is intentionally absent
 * from the type choices (loop guard — only SLA rules move stages). WhatsApp
 * actions carry a free-text template name (must match an approved AiSensy
 * template). All mutations go through the auth-gated server actions.
 */

const TYPE_OPTIONS: { value: StageActionType; label: string }[] = [
  { value: 'send_whatsapp', label: 'Send WhatsApp' },
  { value: 'create_payment_link', label: 'Create payment link' },
]

function typeLabel(type: StageActionType): string {
  return TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

export default function StageActionsEditor({
  stages,
  actionsByStage,
}: {
  stages: Stage[]
  actionsByStage: Record<string, StageAction[]>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">
          On-enter actions
        </h2>
        <p className="mt-1 text-sm text-dim">
          Actions that run, in order, whenever a deal enters a stage — from an
          entry rule, a manual move, or an SLA move. A stage cannot move the deal
          on enter; only SLA rules do that.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-line bg-surface px-4 py-3 text-sm text-red"
        >
          {error}
        </p>
      ) : null}

      {stages.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No stages yet</p>
          <p className="mt-1 text-sm text-dim">
            Add stages first, then attach on-enter actions to them.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {stages.map((stage) => (
            <StageActionsCard
              key={stage.id}
              stage={stage}
              actions={actionsByStage[stage.id] ?? []}
              isPending={isPending}
              onRun={run}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function StageActionsCard({
  stage,
  actions,
  isPending,
  onRun,
}: {
  stage: Stage
  actions: StageAction[]
  isPending: boolean
  onRun: (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) => void
}) {
  const [newType, setNewType] = useState<StageActionType>('send_whatsapp')
  const [newTemplate, setNewTemplate] = useState('')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const config =
      newType === 'send_whatsapp' ? { template: newTemplate.trim() } : {}
    onRun(async () => {
      const result = await createStageAction({
        stage_id: stage.id,
        action_type: newType,
        config,
      })
      if (result.ok) {
        setNewType('send_whatsapp')
        setNewTemplate('')
      }
      return result
    })
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= actions.length) return
    const ordered = actions.map((a) => a.id)
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    onRun(() => reorderStageActions(ordered))
  }

  return (
    <div className="rounded-[12px] border border-line bg-surface p-5">
      <p className="text-sm font-semibold text-text">{stage.name}</p>

      {actions.length === 0 ? (
        <p className="mt-3 text-sm text-dim">No on-enter actions.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-[8px] border border-line">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {actions.map((action, index) => (
                <StageActionRow
                  key={action.id}
                  action={action}
                  index={index}
                  total={actions.length}
                  isPending={isPending}
                  onMove={move}
                  onRun={onRun}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Action</span>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as StageActionType)}
            className={inputClass}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {newType === 'send_whatsapp' ? (
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Template</span>
            <input
              type="text"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
              placeholder="approved AiSensy template name"
              className={`${inputClass} w-[240px]`}
            />
          </label>
        ) : null}
        <button type="submit" disabled={isPending} className={addButtonClass}>
          {isPending ? 'Working…' : 'Add action'}
        </button>
      </form>
    </div>
  )
}

function StageActionRow({
  action,
  index,
  total,
  isPending,
  onMove,
  onRun,
}: {
  action: StageAction
  index: number
  total: number
  isPending: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onRun: (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const [template, setTemplate] = useState(
    typeof action.config?.template === 'string' ? action.config.template : ''
  )

  function save() {
    const config =
      action.action_type === 'send_whatsapp'
        ? { template: template.trim() }
        : {}
    onRun(async () => {
      const result = await updateStageAction(action.id, {
        stage_id: action.stage_id,
        action_type: action.action_type,
        config,
        active: action.active,
      })
      if (result.ok) setEditing(false)
      return result
    })
  }

  const configText =
    action.action_type === 'send_whatsapp'
      ? typeof action.config?.template === 'string' && action.config.template
        ? action.config.template
        : '(no template)'
      : ''

  return (
    <tr className="border-b border-line last:border-b-0 align-middle">
      <td className="px-3 py-2.5 w-[48px]">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="Move action up"
            disabled={isPending || index === 0}
            onClick={() => onMove(index, -1)}
            className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="Move action down"
            disabled={isPending || index === total - 1}
            onClick={() => onMove(index, 1)}
            className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      </td>

      <td className="px-3 py-2.5">
        <span className="font-medium text-text">
          {typeLabel(action.action_type)}
        </span>
      </td>

      <td className="px-3 py-2.5">
        {action.action_type === 'send_whatsapp' ? (
          editing ? (
            <input
              type="text"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className={`${inputClass} w-[240px]`}
              aria-label="Template"
            />
          ) : (
            <code className="text-dim">{configText}</code>
          )
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>

      <td className="px-3 py-2.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            onRun(() =>
              updateStageAction(action.id, {
                stage_id: action.stage_id,
                action_type: action.action_type,
                config: action.config,
                active: !action.active,
              })
            )
          }
          className={
            action.active
              ? 'inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-green transition-opacity hover:opacity-80 disabled:opacity-60'
              : 'inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-dim transition-opacity hover:opacity-80 disabled:opacity-60'
          }
        >
          {action.active ? 'Active' : 'Off'}
        </button>
      </td>

      <td className="px-3 py-2.5 text-right">
        {action.action_type === 'send_whatsapp' && editing ? (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={save}
              className={linkButtonClass}
            >
              Save
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setEditing(false)}
              className="text-sm font-medium text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3">
            {action.action_type === 'send_whatsapp' ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setEditing(true)}
                className={linkButtonClass}
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              disabled={isPending}
              onClick={() => onRun(() => deleteStageAction(action.id))}
              className={dangerButtonClass}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
