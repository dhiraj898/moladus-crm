import type { ReactNode } from 'react'

/**
 * Shared type contract for the list-view framework (design §"Architecture — one
 * framework, per-entity config"). Every admin record list declares a single
 * {@link ListViewConfig} and the generic components (`ViewSwitcher`,
 * `FilterBar`, `TableView`, `ListView`, `KanbanBoard`) render it. Nothing here
 * touches the DB or RBAC — those live in the server-only queries + actions.
 */

/** The three view shapes a list can render. Kanban is offered only where a
 * grouping dimension exists (Deals by stage, Leads by status). */
export type ViewMode = 'kanban' | 'table' | 'list'

/** Visual tone for a chip/meta value, mapped to a design token by the renderer. */
export type Tone = 'dim' | 'accent' | 'green' | 'red' | 'amber'

/**
 * One column of the generic {@link TableView}. `render` returns the cell body
 * for a row; `align:'right'` right-aligns the column and is used with
 * `tabular-nums` for money. `sortable` is a hint for a future client sort.
 */
export interface ColumnDef<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  sortable?: boolean
}

/** A single meta chip for a card row (label + optional tone). */
export interface CardMeta {
  label: string
  tone?: Tone
}

/**
 * Card shape for the generic {@link ListView} / Kanban cards. `title` and
 * optional `subtitle` are accessors; `meta` yields the chip row; `href` links
 * the card to the entity's detail page.
 */
export interface CardDef<T> {
  title: (row: T) => ReactNode
  subtitle?: (row: T) => ReactNode
  meta?: (row: T) => CardMeta[]
  href: (row: T) => string
}

/** One filter control declared by an entity config; rendered by `FilterBar`. */
export interface FilterDef {
  key: string
  label: string
  type: 'search' | 'select' | 'date'
  /** Options for a `select` filter (ignored by other types). */
  options?: { label: string; value: string }[]
}

/** A Kanban grouping column (id = the stored dimension value, e.g. a stage id). */
export interface GroupColumn {
  id: string
  label: string
  tone?: Tone
}

/**
 * The complete per-entity view configuration. `entity` keys the view-mode
 * localStorage preference; `modes` lists the views this list offers (order
 * matters — `modes[0]` is the default); `groupBy` is present only when Kanban
 * is offered.
 */
export interface ListViewConfig<T> {
  entity: string
  modes: ViewMode[]
  columns: ColumnDef<T>[]
  card: CardDef<T>
  filters: FilterDef[]
  groupBy?: {
    options: GroupColumn[]
  }
}
