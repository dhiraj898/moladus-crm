# List Views (Kanban / Table / List) + Search & Filters — Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
Give every admin record list a **view switcher** (Kanban / Table / List) with **search + filters**, via one reusable framework (not duplicated per page). Kanban is offered only where a grouping dimension exists.

## Decisions (locked 2026-08-23)
- **View mapping:** Deals → Kanban(by stage)·Table·List; Leads → Kanban(by status)·Table·List; Contacts/Products/Forms → Table·List. Search + filters on all five.
- **Kanban drag moves live:** Deal card → `changeDealStage` (fires on-enter automation); Lead card → status change.
- **Three views** (Kanban where it fits, Table, List) — a real card/List view in addition to Table.
- **Drag library:** `@dnd-kit/core` + `@dnd-kit/sortable` (accessible, pointer+touch).
- **View persistence:** `?view=` URL param (shareable) + `localStorage` per-entity default.

## Architecture — one framework, per-entity config
New feature dir `src/features/views/`:
- `ViewSwitcher.tsx` — segmented control (only the modes a page supports); writes `?view=` + localStorage.
- `useViewMode.ts` — resolves current mode from URL → localStorage → default.
- `FilterBar.tsx` — renders a page's declared filters (search box + selects + date range) as URL query params; a Reset.
- `TableView.tsx` — generic sortable table from a `columns` config (header, accessor, sortable, align, `tabular-nums` for money); row → detail link.
- `ListView.tsx` — generic roomy card/rows from a `card` config (title, subtitle, meta chips) — mobile-friendly; row → detail link.
- `KanbanBoard.tsx` — columns from a `groupBy` config; cards from the `card` config; `@dnd-kit` drag; calls an `onMove(cardId, toColumnId)` handler; optimistic move + rollback on error.
- `types.ts` — `ListViewConfig<T>` = `{ entity, modes: ViewMode[], columns, card, filters, groupBy? }`; `ViewMode = 'kanban'|'table'|'list'`.

Each list page provides its config + fetches its filtered rows server-side, then renders `<ViewSwitcher>` + `<FilterBar>` + the active view.

## Data / queries
Filtering + search stays **server-side** (RLS deny-all; service-role queries), extending the existing pattern:
- Deals (`listDeals`) and Leads (`searchLeads`) already filter — extend with the full filter set + sort; **respect RBAC scope** (own vs all) as they already do.
- Add filtered list queries for **Contacts** (search, consent), **Products** (search, active), **Forms** (search, status, product).
- Kanban fetches the same filtered set (no pagination) and the client groups by the dimension; Table/List can page later (v1: sensible cap + "showing N", consistent with current lists).

## Per-entity config
- **Deals:** filters = search, payment_status, stage, date range (+ owner if RBAC all-scope); columns = contact, product, total (tabular-nums), stage, payment, created; kanban groupBy = stage (from `stages`), move → `changeDealStage`.
- **Leads:** filters = search, status, product/form, date (+ owner); columns = name, contact, product, status, created; kanban groupBy = status (`LEAD_STATUSES`), move → `changeLeadStatus`.
- **Contacts:** filters = search, marketing_consent; columns = name, whatsapp, email, consent, created.
- **Products:** filters = search, active; columns = name, code, base_price (tabular-nums), gst %, active.
- **Forms:** filters = search, status, product; columns = name, product, status, slug.

## New action
`changeLeadStatus(leadId, status)` (`src/features/crm/leads/actions.ts`) — `requirePermission('leads','edit')` + own-scope IDOR re-check (mirrors deal edits); update `leads.status`; `logActivity('lead', id, 'edited', {status})`; revalidate. (Deals already have `changeDealStage`.)

## Interaction / edge cases
- Kanban move: optimistic (card moves immediately); on action error, roll back + inline toast. Deal moves into a stage may trigger automation (unchanged) — that's intended.
- Empty states per view (no rows / empty column).
- View switch preserves active filters (they live in the URL).
- Terminal/won/lost stages still shown as columns; dragging into them is allowed.
- Accessibility: `@dnd-kit` keyboard drag; Table remains the fully-accessible fallback.
- Design tokens throughout (Inter, dark-default, `--accent`, row-border tables, chips).

## Testing
- `useViewMode` resolution (URL > localStorage > default) — unit.
- Kanban grouping/reducer (rows → columns by dimension; unknown/blank group handling) — unit.
- Filter → query-param mapping (FilterBar builds the expected querystring) — unit.
- `changeLeadStatus` — own-scope guard + update + activity (mocked) — unit.
- Gates incl. `npm run test`.

## Scope / non-goals
- No saved-view presets, no per-user column customization, no CSV-from-view (existing export stays). No server pagination beyond the current cap (can add later).

## Workstreams
1. **view-framework** — `ViewSwitcher`, `useViewMode`, `FilterBar`, `TableView`, `ListView`, config types (+ tests).
2. **kanban** — `KanbanBoard` (@dnd-kit) + `changeLeadStatus` action + grouping tests.
3. **deals+leads pages** — wire all three views (incl. kanban drag) + full filters on Deals and Leads.
4. **contacts+products+forms pages** — Table + List + search/filters on the remaining three.
