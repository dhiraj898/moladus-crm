'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  Stage,
  SlaRule,
  SlaActionType,
  Condition,
  ConditionOp,
} from '@/lib/supabase/types'
import {
  createSlaRule,
  updateSlaRule,
  deleteSlaRule,
  toggleSlaRule,
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
 * SLA rules editor (design §7). After a deal has sat in `from_stage_id` for
 * `delay_minutes` (entered here as days + hours), if the optional condition
 * holds, the rule fires: send a WhatsApp template, or move the deal to another
 * stage. All mutations go through the auth-gated server actions; errors surface
 * inline. Delay and condition mirror the entry-rules primitives so the three
 * editors stay consistent.
 */

const ACTION_OPTIONS: { value: SlaActionType; label: string }[] = [
  { value: 'send_whatsapp', label: 'Send WhatsApp' },
  { value: 'move_stage', label: 'Move to stage' },
]

function actionLabel(type: SlaActionType): string {
  return ACTION_OPTIONS.find((o) => o.value === type)?.label ?? type
}

/** Split a stored `delay_minutes` into whole days + leftover hours for editing. */
function splitDelay(minutes: number): { days: number; hours: number } {
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60) }
}

/** Combine day/hour inputs into a positive `delay_minutes`, or null if invalid. */
function combineDelay(days: string, hours: string): number | null {
  const d = Number.parseInt(days || '0', 10)
  const h = Number.parseInt(hours || '0', 10)
  if (Number.isNaN(d) || Number.isNaN(h) || d < 0 || h < 0) return null
  const minutes = d * 1440 + h * 60
  return minutes > 0 ? minutes : null
}

/** Human-readable delay for display rows. */
function delayToLabel(minutes: number): string {
  const { days, hours } = splitDelay(minutes)
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  return parts.length ? parts.join(' ') : `${minutes}m`
}

export default function SlaRulesEditor({
  stages,
  rules,
}: {
  stages: Stage[]
  rules: SlaRule[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Inline add-form state.
  const [newFromStageId, setNewFromStageId] = useState('')
  const [newDays, setNewDays] = useState('')
  const [newHours, setNewHours] = useState('')
  const [newField, setNewField] = useState('')
  const [newOp, setNewOp] = useState<ConditionOp>('eq')
  const [newValue, setNewValue] = useState('')
  const [newAction, setNewAction] = useState<SlaActionType>('send_whatsapp')
  const [newTemplate, setNewTemplate] = useState('')
  const [newToStageId, setNewToStageId] = useState('')

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
    if (!newFromStageId) {
      setError('Pick a source stage.')
      return
    }
    const delay = combineDelay(newDays, newHours)
    if (delay === null) {
      setError('Set a delay greater than zero (days and/or hours).')
      return
    }
    const field = newField.trim()
    const condition: Condition | null = field
      ? {
          field,
          op: newOp,
          ...(opTakesValue(newOp)
            ? { value: parseValueInput(newOp, newValue) }
            : {}),
        }
      : null
    if (newAction === 'send_whatsapp' && !newTemplate.trim()) {
      setError('A WhatsApp template name is required.')
      return
    }
    if (newAction === 'move_stage' && !newToStageId) {
      setError('Pick a stage to move the deal to.')
      return
    }
    const config =
      newAction === 'send_whatsapp'
        ? { template: newTemplate.trim() }
        : { to_stage_id: newToStageId }

    run(async () => {
      const result = await createSlaRule({
        from_stage_id: newFromStageId,
        delay_minutes: delay,
        condition,
        action_type: newAction,
        config,
      })
      if (result.ok) {
        setNewFromStageId('')
        setNewDays('')
        setNewHours('')
        setNewField('')
        setNewOp('eq')
        setNewValue('')
        setNewAction('send_whatsapp')
        setNewTemplate('')
        setNewToStageId('')
      }
      return result
    })
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">SLA rules</h2>
        <p className="mt-1 text-sm text-dim">
          After a deal has sat in a stage for the set delay, if the (optional)
          condition holds, the rule fires — sending a WhatsApp template or moving
          the deal to another stage. Leave the condition field blank to fire on
          delay alone.
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
            Add stages first, then attach SLA rules to them.
          </p>
        </div>
      ) : (
        <>
          {rules.length === 0 ? (
            <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-text">No SLA rules yet</p>
              <p className="mt-1 text-sm text-dim">
                Add a rule below to act on deals that idle in a stage.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-line">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-4 py-3 font-semibold text-dim">
                      In stage
                    </th>
                    <th className="px-4 py-3 font-semibold text-dim">After</th>
                    <th className="px-4 py-3 font-semibold text-dim">
                      Condition
                    </th>
                    <th className="px-4 py-3 font-semibold text-dim">Action</th>
                    <th className="px-4 py-3 font-semibold text-dim">Active</th>
                    <th className="px-4 py-3 text-right font-semibold text-dim">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <SlaRuleRow
                      key={rule.id}
                      rule={rule}
                      stages={stages}
                      stageName={stageName}
                      isPending={isPending}
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
            <p className="text-sm font-semibold text-text">Add an SLA rule</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Source stage</span>
                <select
                  value={newFromStageId}
                  onChange={(e) => setNewFromStageId(e.target.value)}
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
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Days</span>
                <input
                  type="number"
                  min={0}
                  value={newDays}
                  onChange={(e) => setNewDays(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} w-[80px]`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Hours</span>
                <input
                  type="number"
                  min={0}
                  value={newHours}
                  onChange={(e) => setNewHours(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} w-[80px]`}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Field (optional)</span>
                <input
                  type="text"
                  value={newField}
                  onChange={(e) => setNewField(e.target.value)}
                  placeholder="e.g. paid"
                  maxLength={120}
                  className={inputClass}
                />
              </label>
              {newField.trim() ? (
                <>
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
                            : 'e.g. no'
                        }
                        className={inputClass}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Action</span>
                <select
                  value={newAction}
                  onChange={(e) => setNewAction(e.target.value as SlaActionType)}
                  className={inputClass}
                >
                  {ACTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {newAction === 'send_whatsapp' ? (
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
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className={labelClass}>Move to stage</span>
                  <select
                    value={newToStageId}
                    onChange={(e) => setNewToStageId(e.target.value)}
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
              )}
              <button
                type="submit"
                disabled={isPending}
                className={addButtonClass}
              >
                {isPending ? 'Working…' : 'Add rule'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

function SlaRuleRow({
  rule,
  stages,
  stageName,
  isPending,
  onRun,
}: {
  rule: SlaRule
  stages: Stage[]
  stageName: (id: string) => string
  isPending: boolean
  onRun: (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const initialDelay = splitDelay(rule.delay_minutes)

  const [fromStageId, setFromStageId] = useState(rule.from_stage_id)
  const [days, setDays] = useState(String(initialDelay.days))
  const [hours, setHours] = useState(String(initialDelay.hours))
  const [field, setField] = useState(rule.condition?.field ?? '')
  const [op, setOp] = useState<ConditionOp>(rule.condition?.op ?? 'eq')
  const [value, setValue] = useState(
    rule.condition ? valueToInput(rule.condition.op, rule.condition.value) : ''
  )
  const [action, setAction] = useState<SlaActionType>(rule.action_type)
  const [template, setTemplate] = useState(
    typeof rule.config?.template === 'string' ? rule.config.template : ''
  )
  const [toStageId, setToStageId] = useState(
    typeof rule.config?.to_stage_id === 'string' ? rule.config.to_stage_id : ''
  )

  function startEdit() {
    const d = splitDelay(rule.delay_minutes)
    setFromStageId(rule.from_stage_id)
    setDays(String(d.days))
    setHours(String(d.hours))
    setField(rule.condition?.field ?? '')
    setOp(rule.condition?.op ?? 'eq')
    setValue(
      rule.condition ? valueToInput(rule.condition.op, rule.condition.value) : ''
    )
    setAction(rule.action_type)
    setTemplate(typeof rule.config?.template === 'string' ? rule.config.template : '')
    setToStageId(
      typeof rule.config?.to_stage_id === 'string' ? rule.config.to_stage_id : ''
    )
    setEditing(true)
  }

  function save() {
    const delay = combineDelay(days, hours)
    if (delay === null) return
    const trimmedField = field.trim()
    const condition: Condition | null = trimmedField
      ? {
          field: trimmedField,
          op,
          ...(opTakesValue(op) ? { value: parseValueInput(op, value) } : {}),
        }
      : null
    const config =
      action === 'send_whatsapp'
        ? { template: template.trim() }
        : { to_stage_id: toStageId }
    onRun(async () => {
      const result = await updateSlaRule(rule.id, {
        from_stage_id: fromStageId,
        delay_minutes: delay,
        condition,
        action_type: action,
        config,
        active: rule.active,
      })
      if (result.ok) setEditing(false)
      return result
    })
  }

  const conditionText = rule.condition
    ? `${rule.condition.field} ${rule.condition.op}${
        opTakesValue(rule.condition.op)
          ? ` ${valueToInput(rule.condition.op, rule.condition.value)}`
          : ''
      }`
    : null

  const actionText =
    rule.action_type === 'send_whatsapp'
      ? typeof rule.config?.template === 'string' && rule.config.template
        ? rule.config.template
        : '(no template)'
      : typeof rule.config?.to_stage_id === 'string'
        ? stageName(rule.config.to_stage_id)
        : '(no stage)'

  if (editing) {
    return (
      <tr className="border-b border-line last:border-b-0 align-top">
        <td className="px-4 py-3">
          <select
            value={fromStageId}
            onChange={(e) => setFromStageId(e.target.value)}
            className={inputClass}
            aria-label="Source stage"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`${inputClass} w-[64px]`}
              aria-label="Delay days"
            />
            <span className="text-dim">d</span>
            <input
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={`${inputClass} w-[64px]`}
              aria-label="Delay hours"
            />
            <span className="text-dim">h</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="(none)"
              className={`${inputClass} w-[120px]`}
              aria-label="Field"
            />
            {field.trim() ? (
              <>
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
                    className={`${inputClass} w-[120px]`}
                    aria-label="Value"
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as SlaActionType)}
              className={inputClass}
              aria-label="Action"
            >
              {ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {action === 'send_whatsapp' ? (
              <input
                type="text"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="template name"
                className={`${inputClass} w-[200px]`}
                aria-label="Template"
              />
            ) : (
              <select
                value={toStageId}
                onChange={(e) => setToStageId(e.target.value)}
                className={inputClass}
                aria-label="Move to stage"
              >
                <option value="">Select…</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-dim">—</span>
        </td>
        <td className="px-4 py-3 text-right">
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
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-line last:border-b-0 align-middle">
      <td className="px-4 py-3">
        <span className="font-medium text-text">
          {stageName(rule.from_stage_id)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="tabular-nums text-dim">
          {delayToLabel(rule.delay_minutes)}
        </span>
      </td>
      <td className="px-4 py-3">
        {conditionText ? (
          <code className="text-text">{conditionText}</code>
        ) : (
          <span className="italic text-dim">Always</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="font-medium text-text">
          {actionLabel(rule.action_type)}
        </span>{' '}
        <span className="text-dim">→ {actionText}</span>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => onRun(() => toggleSlaRule(rule.id, !rule.active))}
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
            onClick={() => onRun(() => deleteSlaRule(rule.id))}
            className={dangerButtonClass}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}
