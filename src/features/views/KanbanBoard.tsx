'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import type { CardDef, GroupColumn, Tone } from './types'
import { UNASSIGNED } from './group'

/**
 * Generic Kanban board (design §"KanbanBoard"; plan Task 2.3 + Task 3.2 paging).
 * Renders one droppable column per declared `groupBy` option plus a read-only
 * "Unassigned" column for cards whose grouping value is null/unknown. Each column
 * is paged: the page supplies the first {@link KANBAN_COLUMN_LIMIT} rows per
 * column in `initialRows` and the full per-column `totals`; a per-column footer
 * shows "N of TOTAL" and a **Load more** button (when N < total) that calls
 * `onLoadMore(columnId, offset)` and appends the returned rows. Cards are drawn
 * from the shared {@link CardDef}. Dragging a card to another column is
 * optimistic: the card moves between the local per-column sets immediately (and
 * the two totals are adjusted), then `onMove(cardId, toColumnId)` runs; on
 * failure the move is rolled back and an inline error is shown.
 *
 * Accessibility: a dedicated drag handle carries the pointer + keyboard drag
 * listeners (so the card title stays a normal link), and both a `PointerSensor`
 * (small activation distance, so a click still navigates) and a `KeyboardSensor`
 * are wired. The Table view remains the fully-accessible fallback.
 *
 * Design tokens throughout: columns = `--surface`, cards = `--surface2`, count
 * badges as chips, `--accent` on the active drop target.
 */

/** Result of a "Load more" fetch — the appended `rows` + optional fresh `total`. */
export interface LoadMoreResult<T> {
  ok: boolean
  rows?: T[]
  total?: number
  error?: string
}

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

/** Six-dot grip glyph for the drag handle (design tokens; currentColor). */
function GripIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="3" r="1.4" />
      <circle cx="11" cy="3" r="1.4" />
      <circle cx="5" cy="8" r="1.4" />
      <circle cx="11" cy="8" r="1.4" />
      <circle cx="5" cy="13" r="1.4" />
      <circle cx="11" cy="13" r="1.4" />
    </svg>
  )
}

/** The visible body of a card (shared by the column cards and the drag overlay). */
function CardBody<T>({ card, row }: { card: CardDef<T>; row: T }) {
  const meta = card.meta?.(row) ?? []
  const subtitle = card.subtitle?.(row)
  return (
    <>
      <div className="min-w-0">
        <Link
          href={card.href(row)}
          className="block truncate text-sm font-semibold text-text hover:text-accent"
        >
          {card.title(row)}
        </Link>
        {subtitle ? (
          <div className="mt-0.5 truncate text-sm text-dim">{subtitle}</div>
        ) : null}
      </div>
      {meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {meta.map((m, i) => (
            <span
              key={`${m.label}-${i}`}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chipClass(
                m.tone
              )}`}
            >
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** A draggable card. The grip handle carries the drag listeners. */
function DraggableCard<T>({
  id,
  card,
  row,
  disabled,
}: {
  id: string
  card: CardDef<T>
  row: T
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id, disabled })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 rounded-[10px] border border-line bg-surface2 px-3 py-2.5 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <button
        type="button"
        aria-label="Drag card"
        className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-dim hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        {...listeners}
        {...attributes}
      >
        <GripIcon />
      </button>
      <div className="min-w-0 flex-1">
        <CardBody card={card} row={row} />
      </div>
    </div>
  )
}

/** A droppable column. `droppable=false` renders the read-only Unassigned lane. */
function Column<T>({
  column,
  rows,
  total,
  card,
  getCardId,
  droppable,
  disabled,
  loading,
  onLoadMore,
}: {
  column: GroupColumn
  rows: T[]
  /** Total rows in this column across all pages (drives the footer + badge). */
  total: number
  card: CardDef<T>
  getCardId: (row: T) => string
  droppable: boolean
  disabled: boolean
  /** This column's "Load more" fetch is in flight. */
  loading: boolean
  /** Fetch + append this column's next page; absent when nothing can be paged. */
  onLoadMore?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !droppable })
  const canLoadMore = !!onLoadMore && rows.length < total

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-[12px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="truncate text-sm font-semibold text-text">
          {column.label}
        </span>
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-chip-bg px-2 py-0.5 text-xs font-medium text-dim">
          {total}
        </span>
      </div>
      <div
        ref={droppable ? setNodeRef : undefined}
        className={`flex min-h-[6rem] flex-1 flex-col gap-2 rounded-b-[12px] px-2 pb-2 transition-colors ${
          isOver ? 'bg-chip-bg ring-1 ring-inset ring-accent' : ''
        }`}
      >
        {rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-dim">No cards</p>
        ) : (
          rows.map((row) => (
            <DraggableCard
              key={getCardId(row)}
              id={getCardId(row)}
              card={card}
              row={row}
              disabled={disabled || !droppable}
            />
          ))
        )}
      </div>
      {total > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-dim">
          <span>
            <span className="font-medium text-text">{rows.length}</span> of{' '}
            {total}
          </span>
          {canLoadMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              aria-label={`Load more ${column.label}`}
              className="rounded-[8px] border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-chip-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function KanbanBoard<T>({
  columns,
  initialRows,
  totals,
  card,
  getCardId,
  onMove,
  onLoadMore,
}: {
  columns: GroupColumn[]
  /** First page of rows per column id (+ an {@link UNASSIGNED} key when present). */
  initialRows: Record<string, T[]>
  /** Total rows per column id across all pages — drives "N of TOTAL". */
  totals: Record<string, number>
  card: CardDef<T>
  getCardId: (row: T) => string
  onMove: (
    cardId: string,
    toColumnId: string
  ) => Promise<{ ok: boolean; error?: string }>
  /** Fetch a column's next page for "Load more"; omit to disable paging. */
  onLoadMore?: (columnId: string, offset: number) => Promise<LoadMoreResult<T>>
}) {
  // Per-column loaded rows (paged), seeded from the server's first page. Cloned
  // so drag-move / load-more never mutate the props.
  const [rowsByCol, setRowsByCol] = useState<Record<string, T[]>>(() => {
    const init: Record<string, T[]> = {}
    for (const col of columns) init[col.id] = [...(initialRows[col.id] ?? [])]
    if (initialRows[UNASSIGNED]) init[UNASSIGNED] = [...initialRows[UNASSIGNED]]
    return init
  })
  // Per-column totals, adjusted optimistically on a cross-column move.
  const [totalsByCol, setTotalsByCol] = useState<Record<string, number>>(() => ({
    ...totals,
  }))
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [pending, setPending] = useState(false)
  const [loadingCol, setLoadingCol] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  // Flat id→row lookup + id→column lookup across every loaded column.
  const { byId, colOf } = useMemo(() => {
    const byId = new Map<string, T>()
    const colOf = new Map<string, string>()
    for (const [colId, rows] of Object.entries(rowsByCol)) {
      for (const row of rows) {
        const id = getCardId(row)
        byId.set(id, row)
        colOf.set(id, colId)
      }
    }
    return { byId, colOf }
  }, [rowsByCol, getCardId])

  const hasUnassigned = (rowsByCol[UNASSIGNED]?.length ?? 0) > 0

  const activeRow = activeId ? byId.get(String(activeId)) : undefined

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const cardId = String(active.id)
    const toCol = String(over.id)
    const row = byId.get(cardId)
    if (!row) return

    const fromCol = colOf.get(cardId)
    if (!fromCol || toCol === fromCol) return

    // Snapshot for rollback, then apply the optimistic move: pull the card from
    // its source column, prepend it to the target, and shift both totals.
    const prevRows = rowsByCol
    const prevTotals = totalsByCol
    setError(null)
    setRowsByCol((prev) => ({
      ...prev,
      [fromCol]: (prev[fromCol] ?? []).filter((r) => getCardId(r) !== cardId),
      [toCol]: [row, ...(prev[toCol] ?? [])],
    }))
    setTotalsByCol((prev) => ({
      ...prev,
      [fromCol]: Math.max(0, (prev[fromCol] ?? 1) - 1),
      [toCol]: (prev[toCol] ?? 0) + 1,
    }))
    setPending(true)
    try {
      const res = await onMove(cardId, toCol)
      if (!res.ok) {
        setRowsByCol(prevRows)
        setTotalsByCol(prevTotals)
        setError(res.error ?? 'Could not move the card. Please try again.')
      }
    } catch {
      setRowsByCol(prevRows)
      setTotalsByCol(prevTotals)
      setError('Could not move the card. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function handleLoadMore(columnId: string) {
    if (!onLoadMore || loadingCol) return
    setError(null)
    setLoadingCol(columnId)
    const offset = rowsByCol[columnId]?.length ?? 0
    try {
      const res = await onLoadMore(columnId, offset)
      if (res.ok && res.rows) {
        const appended = res.rows
        setRowsByCol((prev) => {
          const existing = prev[columnId] ?? []
          const seen = new Set(existing.map((r) => getCardId(r)))
          const next = appended.filter((r) => !seen.has(getCardId(r)))
          return { ...prev, [columnId]: [...existing, ...next] }
        })
        if (typeof res.total === 'number') {
          const nextTotal = res.total
          setTotalsByCol((prev) => ({ ...prev, [columnId]: nextTotal }))
        }
      } else if (!res.ok) {
        setError(res.error ?? 'Could not load more cards. Please try again.')
      }
    } catch {
      setError('Could not load more cards. Please try again.')
    } finally {
      setLoadingCol(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div
          role="alert"
          className="rounded-[10px] border border-red/40 bg-chip-bg px-4 py-2.5 text-sm text-red"
        >
          {error}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {hasUnassigned ? (
            <Column
              column={{ id: UNASSIGNED, label: 'Unassigned', tone: 'dim' }}
              rows={rowsByCol[UNASSIGNED] ?? []}
              total={totalsByCol[UNASSIGNED] ?? rowsByCol[UNASSIGNED]?.length ?? 0}
              card={card}
              getCardId={getCardId}
              droppable={false}
              disabled={pending}
              loading={loadingCol === UNASSIGNED}
              onLoadMore={
                onLoadMore ? () => handleLoadMore(UNASSIGNED) : undefined
              }
            />
          ) : null}
          {columns.map((col) => (
            <Column
              key={col.id}
              column={col}
              rows={rowsByCol[col.id] ?? []}
              total={totalsByCol[col.id] ?? rowsByCol[col.id]?.length ?? 0}
              card={card}
              getCardId={getCardId}
              droppable
              disabled={pending}
              loading={loadingCol === col.id}
              onLoadMore={onLoadMore ? () => handleLoadMore(col.id) : undefined}
            />
          ))}
        </div>
        <DragOverlay>
          {activeRow ? (
            <div className="flex items-start gap-2 rounded-[10px] border border-accent bg-surface2 px-3 py-2.5 shadow-lg">
              <span className="mt-0.5 shrink-0 text-dim">
                <GripIcon />
              </span>
              <div className="min-w-0 flex-1">
                <CardBody card={card} row={activeRow} />
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
