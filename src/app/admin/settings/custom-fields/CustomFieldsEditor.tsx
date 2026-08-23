'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomFieldDef, CustomFieldEntity } from '@/lib/supabase/types'
import { reorderCustomFieldDefs } from '@/features/crm/custom-fields/actions'
import { CUSTOM_FIELD_ENTITIES } from '@/features/crm/custom-fields/schema'
import CustomFieldDefRow from './CustomFieldDefRow'

/**
 * Custom Fields editor (spec §8, plan Task 5.1). Client component driving the
 * per-entity definition CRUD: an entity selector (Products / Leads / Deals /
 * Contacts) switches which entity's fields are shown; below it a row-border
 * table (matching StagesEditor) lists that entity's defs with up/down reorder,
 * an active toggle, Edit, and Delete, followed by an expandable "Add a field"
 * editor. Reorder is owned here (it needs the whole list); all other mutations
 * live on each CustomFieldDefRow. Every mutation refreshes the route so the
 * table reflects authoritative server state; errors surface in a `role="alert"`
 * banner.
 */

const ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  product: 'Products',
  lead: 'Leads',
  deal: 'Deals',
  contact: 'Contacts',
}

/** Columns in the def table — used for the expanded editor row's colSpan. */
const COLUMN_COUNT = 7

export default function CustomFieldsEditor({
  defsByEntity,
}: {
  defsByEntity: Record<CustomFieldEntity, CustomFieldDef[]>
}) {
  const router = useRouter()
  const [entity, setEntity] = useState<CustomFieldEntity>('lead')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [isPending, startTransition] = useTransition()

  const defs = defsByEntity[entity] ?? []

  function refresh() {
    router.refresh()
  }

  function selectEntity(next: CustomFieldEntity) {
    setEntity(next)
    setError(null)
    setAdding(false)
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= defs.length) return
    const ordered = defs.map((d) => d.id)
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    setError(null)
    startTransition(async () => {
      const result = await reorderCustomFieldDefs(entity, ordered)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Custom fields</h2>
        <p className="mt-1 text-sm text-dim">
          Define extra fields per entity. They appear on that entity&apos;s
          detail page and inside its create/edit form. Changing a field&apos;s
          type or options does not convert data already stored on records.
          Deactivating a field hides it while keeping its values — the
          reversible alternative to deleting.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line pb-4">
        {CUSTOM_FIELD_ENTITIES.map((e) => {
          const active = e === entity
          return (
            <button
              key={e}
              type="button"
              onClick={() => selectEntity(e)}
              aria-current={active ? 'true' : undefined}
              className={[
                'rounded-[8px] px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-surface2 text-text'
                  : 'text-dim hover:bg-surface hover:text-text',
              ].join(' ')}
            >
              {ENTITY_LABELS[e]}
            </button>
          )
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-line bg-surface px-4 py-3 text-sm text-red"
        >
          {error}
        </p>
      ) : null}

      {defs.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">
            No custom fields for {ENTITY_LABELS[entity].toLowerCase()} yet
          </p>
          <p className="mt-1 text-sm text-dim">
            Add your first field below to start capturing extra data.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Order</th>
                <th className="px-4 py-3 font-semibold text-dim">Label</th>
                <th className="px-4 py-3 font-semibold text-dim">Key</th>
                <th className="px-4 py-3 font-semibold text-dim">Type</th>
                <th className="px-4 py-3 font-semibold text-dim">Required</th>
                <th className="px-4 py-3 font-semibold text-dim">Active</th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {defs.map((def, index) => (
                <CustomFieldDefRow
                  key={def.id}
                  entityType={entity}
                  def={def}
                  index={index}
                  total={defs.length}
                  columns={COLUMN_COUNT}
                  onMove={(direction) => move(index, direction)}
                  onChanged={refresh}
                  onError={setError}
                  busy={isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <CustomFieldDefRow
          entityType={entity}
          def={null}
          onChanged={refresh}
          onError={setError}
          startEditing
          onCancelNew={() => setAdding(false)}
        />
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setAdding(true)
            }}
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            + Add a field
          </button>
        </div>
      )}
    </div>
  )
}
