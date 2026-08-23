'use client'

import type { CustomFieldDef, CustomFieldValues } from '@/lib/supabase/types'
import { CF_ERROR_PREFIX } from './validate'

/**
 * Shared create/edit-form inputs for an entity's custom fields (spec §6.2).
 * Controlled — the parent owns a `customFields` state object and passes
 * `values` + `onChange`, matching LeadForm / ProductForm. Renders one labelled
 * control per ACTIVE def in display order.
 *
 * Field-level errors ride the action's `fieldErrors` under the `cf:` prefix
 * (see CF_ERROR_PREFIX). Returns null when there are no active defs.
 */

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3.5 py-2.5 text-[15px] text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null
  return (
    <span role="alert" className="text-xs text-red">
      {messages[0]}
    </span>
  )
}

function RequiredMark({ required }: { required: boolean }) {
  if (!required) return null
  return <span className="text-accent"> *</span>
}

export default function CustomFieldInputs({
  defs,
  values,
  errors,
  onChange,
}: {
  defs: CustomFieldDef[]
  values: CustomFieldValues
  errors?: Record<string, string[]>
  onChange: (next: CustomFieldValues) => void
}): React.ReactNode {
  if (defs.length === 0) return null

  function set(key: string, value: CustomFieldValues[string]): void {
    onChange({ ...values, [key]: value })
  }

  function toggleMember(key: string, optionValue: string, checked: boolean): void {
    const current = values[key]
    const arr = Array.isArray(current) ? current.map((v) => String(v)) : []
    const next = checked
      ? Array.from(new Set([...arr, optionValue]))
      : arr.filter((v) => v !== optionValue)
    onChange({ ...values, [key]: next })
  }

  return (
    <>
      {defs.map((def) => {
        const errKey = `${CF_ERROR_PREFIX}${def.key}`
        const messages = errors?.[errKey]
        const raw = values[def.key]

        switch (def.field_type) {
          case 'long_text':
            return (
              <label key={def.id} className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </span>
                <textarea
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => set(def.key, e.target.value)}
                  rows={4}
                  className={inputClass}
                />
                <FieldError messages={messages} />
              </label>
            )

          case 'number':
            return (
              <label key={def.id} className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </span>
                <input
                  type="number"
                  value={
                    typeof raw === 'number' || typeof raw === 'string'
                      ? String(raw)
                      : ''
                  }
                  onChange={(e) => set(def.key, e.target.value)}
                  className={inputClass}
                />
                <FieldError messages={messages} />
              </label>
            )

          case 'date':
            return (
              <label key={def.id} className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </span>
                <input
                  type="date"
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => set(def.key, e.target.value)}
                  className={inputClass}
                />
                <FieldError messages={messages} />
              </label>
            )

          case 'yes_no':
            return (
              <label
                key={def.id}
                className="flex items-center justify-between gap-4"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text">
                    {def.label}
                    <RequiredMark required={def.required} />
                  </span>
                  <FieldError messages={messages} />
                </span>
                <input
                  type="checkbox"
                  checked={raw === true}
                  onChange={(e) => set(def.key, e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
              </label>
            )

          case 'dropdown':
            return (
              <label key={def.id} className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </span>
                <select
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => set(def.key, e.target.value)}
                  className={inputClass}
                >
                  <option value="">— Select —</option>
                  {def.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <FieldError messages={messages} />
              </label>
            )

          case 'radio':
            return (
              <fieldset key={def.id} className="flex flex-col gap-1.5">
                <legend className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </legend>
                <div className="flex flex-col gap-2 pt-1">
                  {def.options.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2.5 text-sm text-text"
                    >
                      <input
                        type="radio"
                        name={`cf-${def.key}`}
                        value={opt.value}
                        checked={raw === opt.value}
                        onChange={() => set(def.key, opt.value)}
                        className="h-4 w-4 accent-accent"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <FieldError messages={messages} />
              </fieldset>
            )

          case 'checkbox_group': {
            const selected = Array.isArray(raw) ? raw.map((v) => String(v)) : []
            return (
              <fieldset key={def.id} className="flex flex-col gap-1.5">
                <legend className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </legend>
                <div className="flex flex-col gap-2 pt-1">
                  {def.options.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2.5 text-sm text-text"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(opt.value)}
                        onChange={(e) =>
                          toggleMember(def.key, opt.value, e.target.checked)
                        }
                        className="h-4 w-4 accent-accent"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <FieldError messages={messages} />
              </fieldset>
            )
          }

          case 'short_text':
          default:
            return (
              <label key={def.id} className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {def.label}
                  <RequiredMark required={def.required} />
                </span>
                <input
                  type="text"
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => set(def.key, e.target.value)}
                  className={inputClass}
                />
                <FieldError messages={messages} />
              </label>
            )
        }
      })}
    </>
  )
}
