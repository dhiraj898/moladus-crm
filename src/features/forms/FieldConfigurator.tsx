'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Form, FormField } from '@/lib/supabase/types'
import FieldRow from './FieldRow'
import { reorderFields, publishForm } from './actions'

/**
 * The ordered field list on the builder screen. Owns the working copy of the
 * fields so add / edit / delete / reorder stay responsive without a full page
 * reload, and drives the publish action.
 *
 * The server enforces the publish gate (≥1 field + active product); this
 * component surfaces its result inline.
 */

export default function FieldConfigurator({
  form,
  initialFields,
}: {
  form: Form
  initialFields: FormField[]
}) {
  const router = useRouter()
  const [fields, setFields] = useState<FormField[]>(initialFields)
  const [addingNew, setAddingNew] = useState(false)
  const [status, setStatus] = useState(form.status ?? 'draft')

  const [isReordering, startReorder] = useTransition()
  const [isPublishing, startPublish] = useTransition()
  const [publishError, setPublishError] = useState<string | null>(null)

  function handleSaved(saved: FormField) {
    setFields((prev) => {
      const exists = prev.some((f) => f.id === saved.id)
      const next = exists
        ? prev.map((f) => (f.id === saved.id ? saved : f))
        : [...prev, saved]
      return next.sort((a, b) => a.display_order - b.display_order)
    })
    setAddingNew(false)
  }

  function handleDeleted(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= fields.length) return

    const next = [...fields]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    // Reflect new order locally with recomputed display_order.
    const reindexed = next.map((f, i) => ({ ...f, display_order: i }))
    setFields(reindexed)

    startReorder(async () => {
      const result = await reorderFields(
        form.id,
        reindexed.map((f) => f.id)
      )
      if (!result.ok) {
        // Roll back on failure.
        setFields(fields)
      }
    })
  }

  function handlePublish() {
    setPublishError(null)
    startPublish(async () => {
      const result = await publishForm(form.id)
      if (!result.ok) {
        setPublishError(result.error)
        return
      }
      setStatus('published')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.01em]">Fields</h2>
          <p className="mt-0.5 text-sm text-dim">
            {fields.length} field{fields.length === 1 ? '' : 's'} · shown in
            order on the public form.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          disabled={addingNew}
          className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add field
        </button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-line">
        {fields.length === 0 && !addingNew ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-text">No fields yet</p>
            <p className="mt-1 text-sm text-dim">
              Add your first field to start building this form.
            </p>
          </div>
        ) : (
          fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-stretch border-b border-line last:border-b-0"
            >
              <div className="flex flex-col justify-center gap-1 border-r border-line px-2 py-3">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || isReordering}
                  aria-label="Move up"
                  className="rounded-[6px] px-1.5 py-0.5 text-xs text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === fields.length - 1 || isReordering}
                  aria-label="Move down"
                  className="rounded-[6px] px-1.5 py-0.5 text-xs text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <FieldRow
                  formId={form.id}
                  field={field}
                  otherFieldKeys={fields
                    .filter((f) => f.id !== field.id)
                    .map((f) => f.key)}
                  onSaved={handleSaved}
                  onDeleted={handleDeleted}
                />
              </div>
            </div>
          ))
        )}

        {addingNew ? (
          <div className="border-t border-line">
            <FieldRow
              formId={form.id}
              field={null}
              startEditing
              otherFieldKeys={fields.map((f) => f.key)}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancelNew={() => setAddingNew(false)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text">
              {status === 'published' ? 'Published' : 'Draft'}
            </p>
            <p className="mt-0.5 text-sm text-dim">
              {status === 'published'
                ? 'This form is live and accepting submissions.'
                : 'Publishing requires at least one field and an active product.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing || status === 'published'}
            className="rounded-[8px] bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPublishing
              ? 'Publishing…'
              : status === 'published'
                ? 'Published'
                : 'Publish form'}
          </button>
        </div>
        {publishError ? (
          <p role="alert" className="text-sm text-red">
            {publishError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
