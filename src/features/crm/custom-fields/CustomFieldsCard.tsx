import type { CustomFieldDef, CustomFieldValues } from '@/lib/supabase/types'

/**
 * Shared detail-page render for an entity's custom fields (spec §6.1). Server
 * component — no client JS. Renders a Card matching the detail pages' styling
 * with a <dl> of label/value rows, one per ACTIVE def in display order.
 *
 * Returns null when there are no active defs, so the card never shows an empty
 * shell.
 */

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

/** Format one stored value for display, per the def's type. */
function formatValue(
  def: CustomFieldDef,
  value: CustomFieldValues[string] | undefined
): { text: string; mono: boolean } {
  if (value === undefined || value === null || value === '') {
    return { text: '—', mono: false }
  }

  switch (def.field_type) {
    case 'yes_no':
      return { text: value === true ? 'Yes' : 'No', mono: false }
    case 'number':
      return { text: String(value), mono: true }
    case 'date': {
      const s = String(value)
      const d = new Date(s + 'T00:00:00Z')
      if (Number.isNaN(d.getTime())) return { text: s, mono: false }
      return { text: dateFormatter.format(d), mono: false }
    }
    case 'dropdown':
    case 'radio': {
      const s = String(value)
      const opt = def.options.find((o) => o.value === s)
      return { text: opt ? opt.label : s, mono: false }
    }
    case 'checkbox_group': {
      const arr = Array.isArray(value) ? value : [value]
      if (arr.length === 0) return { text: '—', mono: false }
      const labels = arr.map((v) => {
        const opt = def.options.find((o) => o.value === v)
        return opt ? opt.label : String(v)
      })
      return { text: labels.join(', '), mono: false }
    }
    default:
      return { text: String(value), mono: false }
  }
}

export function CustomFieldsCard({
  defs,
  values,
}: {
  defs: CustomFieldDef[]
  values: CustomFieldValues
}): React.ReactNode {
  if (defs.length === 0) return null

  return (
    <section className="rounded-[12px] border border-line bg-surface p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-dim">
        Custom fields
      </h2>
      <dl>
        {defs.map((def) => {
          const { text, mono } = formatValue(def, values?.[def.key])
          return (
            <div
              key={def.id}
              className="flex justify-between gap-4 border-b border-line py-2.5 last:border-b-0"
            >
              <dt className="text-sm text-dim">{def.label}</dt>
              <dd
                className={[
                  'text-right text-sm font-medium text-text',
                  mono ? 'tabular-nums' : '',
                ].join(' ')}
              >
                {text}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
