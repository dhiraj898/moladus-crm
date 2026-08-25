# Pagination — Design

**Date:** 2026-08-23
**Status:** Draft. Stacks on `feat/list-views` (PR #15).

## Goal
Cut list-page load time by fetching one bounded page at a time instead of up to 500 rows. Page-number pagination for Table/List on all five list pages; per-column "Load more" for the Kanban boards.

## Decisions (locked 2026-08-23)
- **Table/List:** classic page numbers — `?page` + `?pageSize` (default **25**, options 25/50/100), total count, Prev/Next, "Page X of Y".
- **Kanban:** cap per column at **50**, show "N of TOTAL" + a **Load more** per column.
- Stacks on `feat/list-views`.

## Current state (build on this)
`src/features/records/queries.ts` already accepts an optional `QueryPage {offset, limit}` and uses `.range()`; but it returns only `Rows[]` (no total) and the list pages don't pass a page yet (they fetch up to `LIST_LIMIT=500`). This spec: (a) make paged queries return `{ rows, total }` via Supabase `{ count: 'exact' }`; (b) add the UI + URL params; (c) add per-column kanban paging.

## Table/List pagination
- **Queries:** each list query (`listDeals`, `searchLeads`, `listContactsFiltered`, `listProductsFiltered`, `listFormsFiltered`) gains a paged variant returning `PagedResult<T> = { rows: T[]; total: number }` — `.select(..., { count: 'exact' })` + `.range(offset, offset+limit-1)`; keep RBAC scope + filters unchanged. (CSV export keeps iterating via the existing offset paging — it can read `.rows`.)
- **URL params:** `page` (1-based, default 1) + `pageSize` (default 25, clamped to {25,50,100}). Server components read them, compute `offset=(page-1)*pageSize`, and pass `{offset, limit}`.
- **Component:** `src/features/views/Pagination.tsx` — "N results · Page X of Y", Prev/Next (disabled at ends), page-size `<select>`; all update URL params via `useRouter().replace`, preserving `view` + filters. Rendered by `TableView`/`ListView` (or the `*Views` wrapper) when a `pagination` prop is supplied.
- **Reset:** changing any filter or pageSize resets `page` to 1 (FilterBar already rewrites params — it drops `page`).
- **Kanban unaffected by these params** (it has its own paging below).

## Kanban pagination (Deals by stage, Leads by status)
- **Counts:** one grouped count query per board — `select <dim>, count(*) group by <dim>` (deals→stage_id, leads→status), respecting RBAC scope + active filters → `Record<columnId, number>`.
- **Initial rows:** first **50** rows per column (RBAC + filters applied), ordered `created_at desc, id desc`. Fetched per column (5 stages / 8 statuses — small indexed queries) or via a single windowed query; either is fine.
- **Load more:** `<KanbanBoard>` shows a footer per column: "showing N of TOTAL" + **Load more** when N < total. Load more calls a server action `loadColumnRows({ entity, columnId, offset, filters, ctx })` → next 50; client appends. The action re-applies RBAC scope + filters (never trusts the client for scope).
- Drag-to-move still works on loaded cards; a moved card leaves its source column and lands in the target's loaded set.

## Files
- Modify: `src/features/records/queries.ts` (paged `{rows,total}` variants + grouped counts + `loadColumnRows` data fn), `src/features/views/{TableView,ListView,KanbanBoard}.tsx`, the five `*Views.tsx` wrappers + their `page.tsx` (read page/pageSize, pass pagination), `src/app/admin/{deals,leads}` for kanban counts/load-more, `src/features/crm/leads|deals` if a load-more server action lives there.
- Create: `src/features/views/Pagination.tsx`, `src/features/views/pagination.ts` (+ `.test.ts`) — pure page-math (`pageCount`, `clampPage`, `offsetFor`, `pageSize` clamp).

## Testing
- `pagination.ts` pure math: pageCount (ceil, min 1), clampPage (1..pageCount), offsetFor, pageSize clamp to allowed set. (unit)
- Kanban grouping/counts helper + load-more offset math. (unit)
- Paged query returns `{rows,total}` with correct range + count (mocked client). (unit)
- Gates incl. `npm run test`.

## Security / perf
- `loadColumnRows` and all paged queries re-apply RBAC own-vs-all scope server-side — client cannot widen scope via a column/offset param.
- Load-time win: default fetch drops from ≤500 to 25 (Table/List) and ≤50/column (Kanban) + a cheap count.
- `count: 'exact'` on large tables adds a count scan; acceptable at current volume, and indexed filters bound it. (Can switch to `'estimated'` later if counts get slow.)

## Non-goals
No cursor/keyset paging, no saved page state per user, no virtualized infinite scroll. CSV export unchanged (still exports the full filtered set).

## Workstreams
1. **pagination-core** — `pagination.ts` (+tests), `Pagination.tsx`, paged `{rows,total}` query variants for all five entities, `TableView`/`ListView` render the control.
2. **wire-pages** — read `page`/`pageSize` in the five list pages, pass pagination through the `*Views` wrappers, filter/pageSize change resets to page 1.
3. **kanban-paging** — grouped counts + first-50-per-column + `loadColumnRows` action + `KanbanBoard` "Load more" (Deals + Leads).
