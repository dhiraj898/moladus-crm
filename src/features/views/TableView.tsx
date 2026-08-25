import Link from 'next/link'
import type { ColumnDef } from './types'
import Pagination from './Pagination'

/**
 * Generic row-border table driven by a `columns` config (design §"TableView —
 * generic sortable table … row → detail link"). Each row links to the entity's
 * detail page via `href`; a right-aligned column carries `tabular-nums` so money
 * columns align. Renders a design-system empty state when there are no rows.
 *
 * `rowKey`/`href` are supplied by the caller so this stays fully generic over
 * `T`. The whole row is a link (via an overlay `<Link>` on the first cell) to
 * match the existing admin list pattern while keeping cell content selectable.
 */
export default function TableView<T>({
  columns,
  rows,
  rowKey,
  href,
  emptyTitle = 'Nothing here yet',
  emptyHint = 'Adjust the filters or check back later.',
  pagination,
}: {
  columns: ColumnDef<T>[]
  rows: T[]
  rowKey: (row: T) => string
  href: (row: T) => string
  emptyTitle?: string
  emptyHint?: string
  /** When supplied, a page-number footer is rendered below the table. */
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
    <div className="overflow-x-auto rounded-[12px] border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-semibold text-dim ${
                  col.align === 'right' ? 'text-right' : ''
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detail = href(row)
            return (
              <tr
                key={rowKey(row)}
                className="border-b border-line last:border-b-0 transition-colors hover:bg-surface"
              >
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 ${
                      col.align === 'right'
                        ? 'text-right tabular-nums text-dim'
                        : 'text-dim'
                    }`}
                  >
                    {i === 0 ? (
                      <Link
                        href={detail}
                        className="font-medium text-text transition-opacity hover:opacity-80"
                      >
                        {col.render(row)}
                      </Link>
                    ) : (
                      col.render(row)
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {pagination ? <Pagination {...pagination} /> : null}
    </>
  )
}
