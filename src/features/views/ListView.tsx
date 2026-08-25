import Link from 'next/link'
import type { CardDef, Tone } from './types'
import Pagination from './Pagination'

/**
 * Generic roomy card/rows view driven by a `card` config (design §"ListView —
 * generic roomy card/rows … row → detail link"). Each card shows a title,
 * optional subtitle, and a row of meta chips; the whole card links to the
 * entity's detail page. Mobile-friendly single column. Renders a design-system
 * empty state when there are no rows.
 */

/** Map a meta chip tone to its design-token classes (dark-default, CSS vars). */
function chipClass(tone: Tone | undefined): string {
  switch (tone) {
    case 'accent':
      return 'bg-chip-bg text-accent'
    case 'green':
      return 'bg-chip-bg text-green'
    case 'red':
      return 'bg-chip-bg text-red'
    case 'amber':
      return 'bg-chip-bg text-amber'
    default:
      return 'bg-chip-bg text-dim'
  }
}

export default function ListView<T>({
  card,
  rows,
  rowKey,
  emptyTitle = 'Nothing here yet',
  emptyHint = 'Adjust the filters or check back later.',
  pagination,
}: {
  card: CardDef<T>
  rows: T[]
  rowKey: (row: T) => string
  emptyTitle?: string
  emptyHint?: string
  /** When supplied, a page-number footer is rendered below the list. */
  pagination?: { total: number; page: number; pageSize: number }
}) {
  if (rows.length === 0) {
    return (
      <>
        <div className="rounded-[12px] border border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text">{emptyTitle}</p>
          <p className="mt-1 text-sm text-dim">{emptyHint}</p>
        </div>
        {pagination ? <Pagination {...pagination} /> : null}
      </>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const meta = card.meta?.(row) ?? []
        const subtitle = card.subtitle?.(row)
        return (
          <Link
            key={rowKey(row)}
            href={card.href(row)}
            className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-5 py-4 transition-colors hover:bg-surface2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">
                {card.title(row)}
              </div>
              {subtitle ? (
                <div className="mt-0.5 truncate text-sm text-dim">
                  {subtitle}
                </div>
              ) : null}
            </div>
            {meta.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {meta.map((m, i) => (
                  <span
                    key={`${m.label}-${i}`}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${chipClass(
                      m.tone
                    )}`}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            ) : null}
          </Link>
        )
      })}
    </div>
    {pagination ? <Pagination {...pagination} /> : null}
    </>
  )
}
