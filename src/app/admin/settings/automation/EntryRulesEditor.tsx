'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Stage, EntryRule, Condition, ConditionOp } from '@/lib/supabase/types'
import {
  createEntryRule,
  updateEntryRule,
  reorderEntryRules,
  deleteEntryRule,
} from '@/features/crm/automation/actions'
import {
  OP_OPTIONS,
  opTakesValue,
  parseValueInput,
  valueToInput,
  inputClass,
  labelClass,
  addButtonClass,
  linkButtonClass,
  dangerButtonClass,
} from './ui'

/**
 * Entry-rules editor (design §7). On form submit, the first active rule (by
 * ascending priority) whose condition matches routes the deal to its target
 * stage. A NULL-condition rule is the always-matches fallback, shown as
 * "Otherwise → {stage}". Reorder changes evaluation priority. All mutations go
 * through the auth-gated server actions; errors surface inline.
 */

export default function EntryRulesEditor({
  stages,
  rules,
}: {
  stages: Stage[]
  rules: EntryRule[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Inline add-form state (conditional rule).
  const [newField, setNewField] = useState('')
  const [newOp, setNewOp] = useState<ConditionOp>('eq')
  const [newValue, setNewValue] = useState('')
  const [newStageId, setNewStageId] = useState('')

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

  function stageName(id: string): string {
    return stages.find((s) => s.id === id)?.name ?? 'Unknown stage'
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const field = newField.trim()
    if (!field) {
      setError('A form-answer field key is required.')
      return
    }
    if (!newStageId) {
      setError('Pick a target stage.')
      return
    }
    const condition: Condition = {
      field,
      op: newOp,
      ...(opTakesValue(newOp)
        ? { value: parseValueInput(newOp, newValue) }
        : {}),
    }
    run(async () => {
      const result = await createEntryRule({
        condition,
        to_stage_id: newStageId,
      })
      if (result.ok) {
        setNewField('')
        setNewOp('eq')
        setNewValue('')
        setNewStageId('')
      }
      return result
    })
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const ordered = rules.map((r) => r.id)
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    run(() => reorderEntryRules(ordered))
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Entry rules</h2>
        <p className="mt-1 text-sm text-dim">
          When a form is submitted, the first matching rule (top to bottom) sets
          the deal&apos;s starting stage. A rule&apos;s field is a form-answer
          key. The last rule with no condition is the fallback.
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

      {rules.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No entry rules yet</p>
          <p className="mt-1 text-sm text-dim">
            Add a rule below to route submissions by their answers.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Order</th>
                <th className="px-4 py-3 font-semibold text-dim">Condition</th>
                <th className="px-4 py-3 font-semibold text-dim">→ Stage</th>
                <th className="px-4 py-3 font-semibold text-dim">Active</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <EntryRuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  total={rules.length}
                  stages={stages}
                  stageName={stageName}
                  isPending={isPending}
                  onMove={move}
                  onRun={run}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5"
      >
        <p className="text-sm font-semibold text-text">Add an entry rule</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Field</span>
            <input
              type="text"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              placeholder="e.g. want_a_call"
              maxLength={120}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Operator</span>
            <select
              value={newOp}
              onChange={(e) => setNewOp(e.target.value as ConditionOp)}
              className={inputClass}
            >
              {OP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {opTakesValue(newOp) ? (
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Value</span>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={
                  newOp === 'in' || newOp === 'not_in'
                    ? 'comma, separated'
                    : 'e.g. yes'
                }
                className={inputClass}
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Target stage</span>
            <select
              value={newStageId}
              onChange={(e) => setNewStageId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isPending} className={addButtonClass}>
            {isPending ? 'Working…' : 'Add rule'}
          </button>
        </div>
      </form>
    </section>
  )
}

function EntryRuleRow({
  rule,
  index,
  total,
  stages,
  stageName,
  isPending,
  onMove,
  onRun,
}: {
  rule: EntryRule
  index: number
  total: number
  stages: Stage[]
  stageName: (id: string) => string
  isPending: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onRun: (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const isFallback = rule.condition === null

  const [field, setField] = useState(rule.condition?.field ?? '')
  const [op, setOp] = useState<ConditionOp>(rule.condition?.op ?? 'eq')
  const [value, setValue] = useState(
    rule.condition ? valueToInput(rule.condition.op, rule.condition.value) : ''
  )
  const [toStageId, setToStageId] = useState(rule.to_stage_id)

  function startEdit() {
    setField(rule.condition?.field ?? '')
    setOp(rule.condition?.op ?? 'eq')
    setValue(
      rule.condition ? valueToInput(rule.condition.op, rule.condition.value) : ''
    )
    setToStageId(rule.to_stage_id)
    setEditing(true)
  }

  function save() {
    const condition: Condition | null = isFallback
      ? null
      : {
          field: field.trim(),
          op,
          ...(opTakesValue(op) ? { value: parseValueInput(op, value) } : {}),
        }
    onRun(async () => {
      const result = await updateEntryRule(rule.id, {
        condition,
        to_stage_id: toStageId,
        active: rule.active,
      })
      if (result.ok) setEditing(false)
      return result
    })
  }

  return (
    <tr className="border-b border-line last:border-b-0 align-middle">
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-dim">{rule.priority}</span>
          <div className="ml-1 flex flex-col">
            <button
              type="button"
              aria-label="Move rule up"
              disabled={isPending || index === 0}
              onClick={() => onMove(index, -1)}
              className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Move rule down"
              disabled={isPending || index === total - 1}
              onClick={() => onMove(index, 1)}
              className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        {isFallback ? (
          <span className="italic text-dim">Otherwise (fallback)</span>
        ) : editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={field}
              onChange={(e) => setField(e.target.value)}
              className={`${inputClass} w-[140px]`}
              aria-label="Field"
            />
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as ConditionOp)}
              className={inputClass}
              aria-label="Operator"
            >
              {OP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {opTakesValue(op) ? (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${inputClass} w-[140px]`}
                aria-label="Value"
              />
            ) : null}
          </div>
        ) : (
          <code className="text-text">
            {rule.condition!.field}{' '}
            <span className="text-dim">{rule.condition!.op}</span>
            {opTakesValue(rule.condition!.op)
              ? ` ${valueToInput(rule.condition!.op, rule.condition!.value)}`
              : ''}
          </code>
        )}
      </td>

      <td className="px-4 py-3">
        {editing ? (
          <select
            value={toStageId}
            onChange={(e) => setToStageId(e.target.value)}
            className={inputClass}
            aria-label="Target stage"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-medium text-text">
            {stageName(rule.to_stage_id)}
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            onRun(() =>
              updateEntryRule(rule.id, {
                condition: rule.condition,
                to_stage_id: rule.to_stage_id,
                active: !rule.active,
              })
            )
          }
          className={
            rule.active
              ? 'inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-green transition-opacity hover:opacity-80 disabled:opacity-60'
              : 'inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-dim transition-opacity hover:opacity-80 disabled:opacity-60'
          }
        >
          {rule.active ? 'Active' : 'Off'}
        </button>
      </td>

      <td className="px-4 py-3 text-right">
        {editing ? (
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
            <button
              type="button"
              disabled={isPending}
              onClick={startEdit}
              className={linkButtonClass}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => onRun(() => deleteEntryRule(rule.id))}
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
