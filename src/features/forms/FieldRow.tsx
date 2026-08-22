'use client'

import { useState, useTransition } from 'react'
import type { FormField, FieldOption } from '@/lib/supabase/types'
import { upsertField, deleteField, type ActionResult } from './actions'
import {
  FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  BINDINGS,
  TRANSFORMS,
  VISIBLE_WHEN_OPERATORS,
  type FieldInputRaw,
} from './schema'

/**
 * A single field on the builder screen. Collapsed it shows a summary plus
 * edit/delete controls; expanded it exposes every field attribute — type,
 * label, key, required, placeholder, options (for choice types), binding,
 * transform, and a visible_when rule editor.
 *
 * Reordering (up/down) is owned by the parent FieldConfigurator, since it
 * needs the full list to persist the new order.
 */

type Props = {
  formId: string
  /** Existing field, or `null` when adding a new one. */
  field: FormField | null
  /** Keys of the OTHER fields on this form, for the visible_when picker. */
  otherFieldKeys: string[]
  /** True when a new-field editor should render expanded immediately. */
  startEditing?: boolean
  onSaved: (field: FormField) => void
  onDeleted: (id: string) => void
  /** Called when a brand-new (unsaved) row is cancelled. */
  onCancelNew?: () => void
}

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass =
  'text-[11px] font-semibold uppercase tracking-[0.12em] text-dim'

const FIELD_TYPE_LABELS: Record<(typeof FIELD_TYPES)[number], string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  dropdown: 'Dropdown',
  radio: 'Radio',
  checkbox_group: 'Checkbox group',
  date: 'Date',
  statement: 'Statement',
  yes_no: 'Yes / No',
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null
  return (
    <span role="alert" className="text-xs text-red">
      {messages[0]}
    </span>
  )
}

function needsOptions(type: string): boolean {
  return (CHOICE_FIELD_TYPES as readonly string[]).includes(type)
}

export default function FieldRow({
  formId,
  field,
  otherFieldKeys,
  startEditing = false,
  onSaved,
  onDeleted,
  onCancelNew,
}: Props) {
  const isNew = field === null
  const [editing, setEditing] = useState(isNew || startEditing)
  const [isPending, startTransition] = useTransition()
  const [isDeleting, startDeleteTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const [key, setKey] = useState(field?.key ?? '')
  const [label, setLabel] = useState(field?.label ?? '')
  const [fieldType, setFieldType] = useState(field?.field_type ?? 'short_text')
  const [required, setRequired] = useState(field?.required ?? true)
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '')
  const [binding, setBinding] = useState<string>(field?.binding ?? '')
  const [transform, setTransform] = useState<string>(field?.transform ?? '')
  const [options, setOptions] = useState<FieldOption[]>(field?.options ?? [])

  const initialVw = field?.visible_when ?? null
  const [vwEnabled, setVwEnabled] = useState<boolean>(initialVw !== null)
  const [vwFieldKey, setVwFieldKey] = useState(initialVw?.field_key ?? '')
  const [vwOperator, setVwOperator] = useState(initialVw?.operator ?? 'eq')
  const [vwValue, setVwValue] = useState(
    initialVw
      ? Array.isArray(initialVw.value)
        ? initialVw.value.join(', ')
        : initialVw.value
      : ''
  )

  const showOptions = needsOptions(fieldType)
  const vwIsList = vwOperator === 'in' || vwOperator === 'not_in'

  function addOption() {
    setOptions((prev) => [...prev, { label: '', value: '' }])
  }
  function updateOption(index: number, patch: Partial<FieldOption>) {
    setOptions((prev) =>
      prev.map((opt, i) => (i === index ? { ...opt, ...patch } : opt))
    )
  }
  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  function resetFromField() {
    setKey(field?.key ?? '')
    setLabel(field?.label ?? '')
    setFieldType(field?.field_type ?? 'short_text')
    setRequired(field?.required ?? true)
    setPlaceholder(field?.placeholder ?? '')
    setBinding(field?.binding ?? '')
    setTransform(field?.transform ?? '')
    setOptions(field?.options ?? [])
    setVwEnabled(initialVw !== null)
    setVwFieldKey(initialVw?.field_key ?? '')
    setVwOperator(initialVw?.operator ?? 'eq')
    setVwValue(
      initialVw
        ? Array.isArray(initialVw.value)
          ? initialVw.value.join(', ')
          : initialVw.value
        : ''
    )
    setFormError(null)
    setFieldErrors({})
  }

  function handleSave() {
    setFormError(null)
    setFieldErrors({})

    const vwValueParsed: string | string[] = vwIsList
      ? vwValue
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : vwValue.trim()

    const input: FieldInputRaw & { id?: string } = {
      id: field?.id,
      key,
      label,
      field_type: fieldType,
      // Statement fields collect no answer, so they can never be required — the
      // schema's superRefine rejects a required statement. The Required control
      // is hidden for this type, so force the value rather than trusting state.
      required: fieldType === 'statement' ? false : required,
      display_order: field?.display_order ?? 0,
      options: showOptions ? options : null,
      placeholder,
      binding: binding === '' ? null : (binding as FieldInputRaw['binding']),
      transform:
        transform === '' ? null : (transform as FieldInputRaw['transform']),
      visible_when: vwEnabled
        ? {
            field_key: vwFieldKey,
            operator: vwOperator,
            value: vwValueParsed,
          }
        : null,
    }

    startTransition(async () => {
      const result: ActionResult<FormField> = await upsertField(formId, input)
      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      onSaved(result.data)
      if (!isNew) setEditing(false)
    })
  }

  function handleDelete() {
    if (!field) return
    startDeleteTransition(async () => {
      const result = await deleteField(field.id)
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      onDeleted(field.id)
    })
  }

  // -------------------------------------------------------------------------
  // Collapsed summary
  // -------------------------------------------------------------------------
  if (!editing && field) {
    return (
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text">
              {field.label}
            </span>
            {field.required ? null : (
              <span className="rounded-full bg-chip-bg px-2 py-0.5 text-[10px] font-medium text-dim">
                optional
              </span>
            )}
            {field.visible_when ? (
              <span
                className="rounded-full bg-chip-bg px-2 py-0.5 text-[10px] font-medium text-amber"
                title={`Shown when ${field.visible_when.field_key} ${field.visible_when.operator} ${
                  Array.isArray(field.visible_when.value)
                    ? field.visible_when.value.join(', ')
                    : field.visible_when.value
                }`}
              >
                conditional
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
            <code className="font-mono">{field.key}</code>
            <span aria-hidden>·</span>
            <span>{FIELD_TYPE_LABELS[field.field_type]}</span>
            {field.binding ? (
              <>
                <span aria-hidden>·</span>
                <span>→ {field.binding}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-medium text-accent transition-opacity hover:opacity-80"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-sm font-medium text-red transition-opacity hover:opacity-80 disabled:opacity-60"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Expanded editor
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 bg-surface px-4 py-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
          <FieldError messages={fieldErrors.label} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Key</span>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="snake_case"
            className={`${inputClass} font-mono`}
          />
          <FieldError messages={fieldErrors.key} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Type</span>
          <select
            value={fieldType}
            onChange={(e) => {
              const next = e.target.value as (typeof FIELD_TYPES)[number]
              setFieldType(next)
              // Statement fields cannot be required; clear the flag so the
              // hidden control's state matches what will be saved.
              if (next === 'statement') setRequired(false)
            }}
            className={inputClass}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError messages={fieldErrors.field_type} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Placeholder</span>
          <input
            type="text"
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
          <FieldError messages={fieldErrors.placeholder} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Binding</span>
          <select
            value={binding}
            onChange={(e) => setBinding(e.target.value)}
            className={inputClass}
          >
            <option value="">Store only (no binding)</option>
            {BINDINGS.filter((b) => b !== 'store_only').map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <FieldError messages={fieldErrors.binding} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Transform</span>
          <select
            value={transform}
            onChange={(e) => setTransform(e.target.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {TRANSFORMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <FieldError messages={fieldErrors.transform} />
        </label>
      </div>

      {fieldType === 'statement' ? null : (
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm font-medium text-text">Required</span>
          <FieldError messages={fieldErrors.required} />
        </label>
      )}

      {showOptions ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
          <div className="flex items-center justify-between">
            <span className={labelClass}>Options</span>
            <button
              type="button"
              onClick={addOption}
              className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
            >
              + Add option
            </button>
          </div>
          {options.length === 0 ? (
            <p className="text-xs text-dim">No options yet.</p>
          ) : (
            options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(i, { label: e.target.value })}
                  placeholder="Label"
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="text"
                  value={opt.value}
                  onChange={(e) => updateOption(i, { value: e.target.value })}
                  placeholder="value"
                  className={`${inputClass} flex-1 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="shrink-0 rounded-[8px] border border-line px-2.5 py-2 text-xs text-dim transition-colors hover:text-red"
                  aria-label="Remove option"
                >
                  ✕
                </button>
              </div>
            ))
          )}
          <FieldError messages={fieldErrors.options} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={vwEnabled}
            onChange={(e) => setVwEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm font-medium text-text">
            Only show this field when…
          </span>
        </label>

        {vwEnabled ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={vwFieldKey}
              onChange={(e) => setVwFieldKey(e.target.value)}
              className={inputClass}
              aria-label="Referenced field"
            >
              <option value="">Field…</option>
              {otherFieldKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={vwOperator}
              onChange={(e) =>
                setVwOperator(
                  e.target.value as (typeof VISIBLE_WHEN_OPERATORS)[number]
                )
              }
              className={inputClass}
              aria-label="Operator"
            >
              {VISIBLE_WHEN_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={vwValue}
              onChange={(e) => setVwValue(e.target.value)}
              placeholder={vwIsList ? 'a, b, c' : 'value'}
              className={inputClass}
              aria-label="Value"
            />
          </div>
        ) : null}
        {vwEnabled ? (
          <span className="text-xs text-dim">
            {vwIsList
              ? 'Comma-separate multiple values.'
              : 'Single value comparison.'}
          </span>
        ) : null}
        <FieldError messages={fieldErrors.visible_when} />
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-red">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : isNew ? 'Add field' : 'Save field'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (isNew) {
              onCancelNew?.()
            } else {
              resetFromField()
              setEditing(false)
            }
          }}
          className="rounded-[8px] border border-line px-4 py-2 text-sm font-medium text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
