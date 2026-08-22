'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Stage, StageType } from '@/lib/supabase/types'
import {
  createStage,
  updateStage,
  reorderStages,
  setDefaultStage,
  deleteStage,
} from '@/features/crm/stages/actions'

/**
 * Stages editor (spec §6). Client component driving the full stage CRUD:
 * inline add, rename, up/down reorder, set-default, and guarded delete. All
 * mutations run through the Task 2.1 server actions; `ActionResult` errors are
 * surfaced inline via a `role="alert"` banner. Every mutation refreshes the
 * route so the table reflects the authoritative server state.
 */

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

const TYPE_OPTIONS: { value: StageType; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

/** Coloured chip describing a stage's type, using design tokens only. */
function TypeChip({ type }: { type: StageType }) {
  const styles: Record<StageType, string> = {
    open: 'bg-chip-bg text-dim',
    won: 'bg-chip-bg text-green',
    lost: 'bg-chip-bg text-red',
  }
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[type]}`}
    >
      {label}
    </span>
  )
}

export default function StagesEditor({ stages }: { stages: Stage[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Inline add-form state.
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<StageType>('open')

  // Inline rename state (null = not editing).
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<StageType>('open')

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

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    run(async () => {
      const result = await createStage({ name, type: newType })
      if (result.ok) {
        setNewName('')
        setNewType('open')
      }
      return result
    })
  }

  function startEdit(stage: Stage) {
    setError(null)
    setEditId(stage.id)
    setEditName(stage.name)
    setEditType(stage.type)
  }

  function cancelEdit() {
    setEditId(null)
    setEditName('')
  }

  function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    run(async () => {
      const result = await updateStage(id, { name, type: editType })
      if (result.ok) cancelEdit()
      return result
    })
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= stages.length) return
    const ordered = stages.map((s) => s.id)
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    run(() => reorderStages(ordered))
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Deal stages</h2>
        <p className="mt-1 text-sm text-dim">
          Steps a deal moves through. New deals start at the default stage.
          Stages in use by a deal, and the default stage, cannot be deleted.
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
            Add your first stage below to start building the pipeline.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Order</th>
                <th className="px-4 py-3 font-semibold text-dim">Name</th>
                <th className="px-4 py-3 font-semibold text-dim">Type</th>
                <th className="px-4 py-3 font-semibold text-dim">Default</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, index) => {
                const editing = editId === stage.id
                return (
                  <tr
                    key={stage.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-1">
                        <span className="tabular-nums text-dim">
                          {stage.display_order}
                        </span>
                        <div className="ml-1 flex flex-col">
                          <button
                            type="button"
                            aria-label={`Move ${stage.name} up`}
                            disabled={isPending || index === 0}
                            onClick={() => move(index, -1)}
                            className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${stage.name} down`}
                            disabled={isPending || index === stages.length - 1}
                            onClick={() => move(index, 1)}
                            className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 align-middle">
                      {editing ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={`${inputClass} w-full max-w-[240px]`}
                          aria-label="Stage name"
                        />
                      ) : (
                        <span className="font-medium text-text">
                          {stage.name}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 align-middle">
                      {editing ? (
                        <select
                          value={editType}
                          onChange={(e) =>
                            setEditType(e.target.value as StageType)
                          }
                          className={inputClass}
                          aria-label="Stage type"
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <TypeChip type={stage.type} />
                      )}
                    </td>

                    <td className="px-4 py-3 align-middle">
                      {stage.is_default ? (
                        <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-accent">
                          Default
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => setDefaultStage(stage.id))}
                          className="text-xs font-medium text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Set default
                        </button>
                      )}
                    </td>

                    <td className="px-4 py-3 align-middle text-right">
                      {editing ? (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => saveEdit(stage.id)}
                            className="text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={cancelEdit}
                            className="text-sm font-medium text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => startEdit(stage)}
                            className="text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            disabled={isPending || stage.is_default}
                            onClick={() => run(() => deleteStage(stage.id))}
                            title={
                              stage.is_default
                                ? 'The default stage cannot be deleted.'
                                : undefined
                            }
                            className="text-sm font-medium text-dim transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5"
      >
        <p className="text-sm font-semibold text-text">Add a stage</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={labelClass}>Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Negotiation"
              maxLength={60}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Type</span>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as StageType)}
              className={inputClass}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Working…' : 'Add stage'}
          </button>
        </div>
      </form>
    </div>
  )
}
