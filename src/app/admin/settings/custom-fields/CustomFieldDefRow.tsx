'use client'

import { useState, useTransition } from 'react'
import type {
  CustomFieldDef,
  CustomFieldEntity,
  CustomFieldType,
  FieldOption,
} from '@/lib/supabase/types'
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  setCustomFieldDefActive,
  deleteCustomFieldDef,
} from '@/features/crm/custom-fields/actions'
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_CHOICE_FIELD_TYPES,
} from '@/features/crm/custom-fields/schema'

/**
 * One custom-field definition in the Settings editor (spec §8, plan Task 5.1).
 *
 * Two shapes, driven by `def`:
 * - `def !== null` renders a table row — a collapsed summary (order + reorder
 *   arrows, label, mono key, type/required/inactive chips, active toggle, Edit,
 *   Delete), or, when editing, a full-width expanded editor row.
 * - `def === null` renders the standalone "add a field" card (used below the
 *   table). The same editor body serves both.
 *
 * `key` and `entity_type` are create-only identity: the Key input is locked on
 * edit. Reorder is owned by the parent (it needs the whole list), so the arrows
 * call `onMove`. Every mutation runs through the Task 3.3 server actions and
 * asks the parent to `router.refresh()` via `onChanged`.
 */

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass =
  'text-[11px] font-semibold uppercase tracking-[0.12em] text-dim'

const TYPE_LABELS: Record<CustomFieldType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  dropdown: 'Dropdown',
  radio: 'Radio',
  checkbox_group: 'Checkbox group',
  date: 'Date',
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

function needsOptions(type: CustomFieldType): boolean {
  return (CUSTOM_CHOICE_FIELD_TYPES as readonly string[]).includes(type)
}

/** Derive a snake_case key suggestion from a human label. */
function suggestKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/g, '')
}

type Props = {
  entityType: CustomFieldEntity
  /** Existing def, or `null` when adding a new one. */
  def: CustomFieldDef | null
  /** Position in the list (existing defs only). */
  index?: number
  /** Total defs in the list (existing defs only). */
  total?: number
  /** Column count for the expanded editor's colSpan (existing defs only). */
  columns?: number
  /** Reorder one step (existing defs only). */
  onMove?: (direction: -1 | 1) => void
  /** Parent refresh after a successful mutation. */
  onChanged: () => void
  /** Surface a section-level error in the parent's banner. */
  onError: (message: string | null) => void
  /** Render the editor expanded on mount (used by the add card). */
  startEditing?: boolean
  /** Called when a brand-new (unsaved) editor is cancelled. */
  onCancelNew?: () => void
  /** True while the parent runs a list-level mutation (e.g. reorder). */
  busy?: boolean
}

export default function CustomFieldDefRow({
  entityType,
  def,
  index,
  total,
  columns = 7,
  onMove,
  onChanged,
  onError,
  startEditing = false,
  onCancelNew,
  busy = false,
}: Props) {
  const isNew = def === null
  const [editing, setEditing] = useState(isNew || startEditing)
  const [isPending, startTransition] = useTransition()
  const [isToggling, startToggleTransition] = useTransition()
  const [isDeleting, startDeleteTransition] = useTransition()

  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const [label, setLabel] = useState(def?.label ?? '')
  const [key, setKey] = useState(def?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(!isNew)
  const [fieldType, setFieldType] = useState<CustomFieldType>(
    def?.field_type ?? 'short_text'
  )
  const [required, setRequired] = useState(def?.required ?? false)
  const [options, setOptions] = useState<FieldOption[]>(def?.options ?? [])

  const showOptions = needsOptions(fieldType)

  function addOption() {
    setOptions((prev) => [...prev, { label: '', value: '' }])
  }
  function updateOption(i: number, patch: Partial<FieldOption>) {
    setOptions((prev) =>
      prev.map((opt, idx) => (idx === i ? { ...opt, ...patch } : opt))
    )
  }
  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i))
  }

  function resetToNew() {
    setLabel('')
    setKey('')
    setKeyTouched(false)
    setFieldType('short_text')
    setRequired(false)
    setOptions([])
    setFormError(null)
    setFieldErrors({})
  }

  function resetFromDef() {
    setLabel(def?.label ?? '')
    setKey(def?.key ?? '')
    setFieldType(def?.field_type ?? 'short_text')
    setRequired(def?.required ?? false)
    setOptions(def?.options ?? [])
    setFormError(null)
    setFieldErrors({})
  }

  function handleSave() {
    setFormError(null)
    setFieldErrors({})
    onError(null)

    const input = {
      entity_type: entityType,
      key: isNew ? key.trim() : def!.key,
      label: label.trim(),
      field_type: fieldType,
      required,
      options: showOptions ? options : [],
    }

    startTransition(async () => {
      const result = isNew
        ? await createCustomFieldDef(input)
        : await updateCustomFieldDef(def!.id, input)

      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      onChanged()
      if (isNew) resetToNew()
      else setEditing(false)
    })
  }

  function handleCancel() {
    if (isNew) {
      onCancelNew?.()
      return
    }
    resetFromDef()
    setEditing(false)
  }

  function handleToggleActive() {
    if (!def) return
    onError(null)
    startToggleTransition(async () => {
      const result = await setCustomFieldDefActive(def.id, !def.active)
      if (!result.ok) {
        onError(result.error)
        return
      }
      onChanged()
    })
  }

  function handleDelete() {
    if (!def) return
    const confirmed = window.confirm(
      `Delete “${def.label}”? Values already stored on records are not removed but will stop showing. Deactivating the field instead hides it while keeping its data and is reversible.`
    )
    if (!confirmed) return
    onError(null)
    startDeleteTransition(async () => {
      const result = await deleteCustomFieldDef(def.id)
      if (!result.ok) {
        onError(result.error)
        return
      }
      onChanged()
    })
  }

  // ---------------------------------------------------------------------------
  // Shared editor body (used by both the expanded row and the add card)
  // ---------------------------------------------------------------------------
  const editorBody = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              const next = e.target.value
              setLabel(next)
              if (isNew && !keyTouched) setKey(suggestKey(next))
            }}
            placeholder="e.g. Cohort"
            className={inputClass}
          />
          <FieldError messages={fieldErrors.label} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Key</span>
          <input
            type="text"
            value={key}
            onChange={(e) => {
              setKeyTouched(true)
              setKey(e.target.value)
            }}
            readOnly={!isNew}
            placeholder="snake_case"
            className={`${inputClass} font-mono ${
              isNew ? '' : 'cursor-not-allowed opacity-60'
            }`}
            title={isNew ? undefined : 'The key cannot be changed after creation.'}
          />
          <FieldError messages={fieldErrors.key} />
          {isNew ? (
            <span className="text-[11px] text-dim">
              The stable storage key — lowercase, digits, underscores. Cannot be
              changed later.
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Type</span>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            className={inputClass}
          >
            {CUSTOM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <FieldError messages={fieldErrors.field_type} />
        </label>

        <label className="flex items-center gap-2.5 sm:mt-6">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm font-medium text-text">Required</span>
          <FieldError messages={fieldErrors.required} />
        </label>
      </div>

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
          onClick={handleCancel}
          disabled={isPending}
          className="rounded-[8px] border border-line px-4 py-2 text-sm font-medium text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Add card (def === null)
  // ---------------------------------------------------------------------------
  if (isNew) {
    return (
      <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5">
        <p className="text-sm font-semibold text-text">Add a field</p>
        {editorBody}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Expanded editor row
  // ---------------------------------------------------------------------------
  if (editing) {
    return (
      <tr className="border-b border-line last:border-b-0">
        <td colSpan={columns} className="p-0">
          <div className="bg-surface px-4 py-4">{editorBody}</div>
        </td>
      </tr>
    )
  }

  // ---------------------------------------------------------------------------
  // Collapsed summary row
  // ---------------------------------------------------------------------------
  const atTop = index === 0
  const atBottom = total !== undefined && index === total - 1

  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-dim">{def.display_order}</span>
          <div className="ml-1 flex flex-col">
            <button
              type="button"
              aria-label={`Move ${def.label} up`}
              disabled={busy || atTop}
              onClick={() => onMove?.(-1)}
              className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${def.label} down`}
              disabled={busy || atBottom}
              onClick={() => onMove?.(1)}
              className="leading-none text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 align-middle">
        <span className="font-medium text-text">{def.label}</span>
      </td>

      <td className="px-4 py-3 align-middle">
        <code className="font-mono text-xs text-dim">{def.key}</code>
      </td>

      <td className="px-4 py-3 align-middle">
        <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-dim">
          {TYPE_LABELS[def.field_type]}
        </span>
      </td>

      <td className="px-4 py-3 align-middle">
        {def.required ? (
          <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-accent">
            Required
          </span>
        ) : (
          <span className="text-dim">—</span>
        )}
      </td>

      <td className="px-4 py-3 align-middle">
        <button
          type="button"
          disabled={isToggling}
          onClick={handleToggleActive}
          className={[
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60',
            def.active ? 'bg-chip-bg text-green' : 'bg-chip-bg text-dim',
          ].join(' ')}
          title={
            def.active
              ? 'Active — click to deactivate (hides the field, keeps values)'
              : 'Inactive — click to reactivate'
          }
        >
          {isToggling ? 'Working…' : def.active ? 'Active' : 'Inactive'}
        </button>
      </td>

      <td className="px-4 py-3 align-middle text-right">
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isDeleting}
            onClick={() => {
              setFormError(null)
              setFieldErrors({})
              setEditing(true)
            }}
            className="text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDelete}
            className="text-sm font-medium text-dim transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  )
}
