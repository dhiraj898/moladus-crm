# Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Page-number pagination for Table/List on all five list pages + per-column "Load more" for Kanban, cutting list load time (fetch 25/page instead of ≤500). Stacks on `feat/list-views`.

**Architecture:** Paged list queries return `{ rows, total }` via Supabase `{count:'exact'}` + `.range()`; a shared `Pagination` component driven by `?page`/`?pageSize` URL params; Kanban gets grouped counts + a `loadColumnRows` server action for per-column "Load more". RBAC scope + filters re-applied server-side everywhere. See `docs/superpowers/specs/2026-08-23-pagination-design.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase service-role, Vitest, Tailwind tokens.

## Global Constraints
- Paged queries + `loadColumnRows` re-apply RBAC own-vs-all scope (reuse `ownerScopeFilter`/ctx); client cannot widen scope via page/offset/column params.
- `pageSize` clamped to {25,50,100} (default 25); `page` 1-based, clamped to `[1, pageCount]`.
- URL is the source of truth for page/pageSize/filters; changing a filter or pageSize resets `page` to 1.
- Kanban per-column cap 50; "Load more" fetches the next 50 for that column only.
- Design tokens (Inter, dark-default, `--accent`, row-border tables). Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test`). No `npm run dev` in a gate. No migration.

## File Structure
- Create: `src/features/views/pagination.ts` (+`pagination.test.ts`), `src/features/views/Pagination.tsx`.
- Modify: `src/features/records/queries.ts` (paged `{rows,total}` + grouped counts + `loadColumnRows`), `src/features/views/{TableView,ListView,KanbanBoard}.tsx`, five `*Views.tsx` wrappers + their `page.tsx`.

---

## Workstream 1: pagination-core

### Task 1.1: pure page-math (TDD)
**Files:** Create `src/features/views/pagination.ts`, `pagination.test.ts`
**Produces:** `PAGE_SIZES=[25,50,100] as const`; `clampPageSize(n:unknown):25|50|100` (default 25); `pageCount(total:number, pageSize:number):number` (`max(1, ceil(total/pageSize))`); `clampPage(page:unknown, total:number, pageSize:number):number` (1..pageCount); `offsetFor(page:number, pageSize:number):number`.
- [ ] **Step 1: Test** — clampPageSize (valid passes, junk/undefined→25, 30→25 nearest-not-required just default); pageCount (0→1, 25/25→1, 26/25→2); clampPage (0→1, 99 with 1 page→1, valid stays); offsetFor((page-1)*size).
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit** `feat(views): pagination page-math + tests`.

### Task 1.2: paged query variants
**Files:** Modify `src/features/records/queries.ts`
**Produces:** `PagedResult<T>={rows:T[];total:number}`. Add paged variants (or extend existing signatures) returning `PagedResult` when a `page:{offset,limit}` is passed: `listDealsPaged`, `searchLeadsPaged`, `listContactsPaged`, `listProductsPaged`, `listFormsPaged` — each `.select(cols, { count: 'exact' })`, apply RBAC scope + all existing filters + sort + `.range(offset, offset+limit-1)`, return `{ rows: data??[], total: count??0 }`.
- [ ] **Step 1:** Implement the five paged variants reusing the existing filter/scope code (do not duplicate filter logic — factor a shared builder if cleaner). Keep the non-paged/export callers working.
- [ ] **Step 2: Gates** (type-check + build). **Commit** `feat(records): paged list queries returning {rows,total}`.

### Task 1.3: Pagination component + Table/List render it
**Files:** Create `src/features/views/Pagination.tsx`; Modify `TableView.tsx`, `ListView.tsx`
**Produces:** `<Pagination total page pageSize />` (client): "N results · Page X of Y", Prev/Next (disabled at ends), page-size select; updates `?page`/`?pageSize` via `useRouter().replace` preserving `view`+filters; setting pageSize resets page=1. `TableView`/`ListView` accept an optional `pagination?: {total,page,pageSize}` and render `<Pagination>` in a footer when present.
- [ ] **Step 1:** Implement; design tokens; accessible (aria-labels on Prev/Next).
- [ ] **Step 2: Gates. Commit** `feat(views): Pagination control in Table/List`.

---

## Workstream 2: wire-pages (Table/List pagination on all five)

### Task 2.1: Deals + Leads Table/List pagination
**Files:** Modify `src/app/admin/deals/page.tsx` + `DealsViews.tsx`; `src/app/admin/leads/page.tsx` + `LeadsViews.tsx`
- [ ] **Step 1:** `page.tsx` (server): read `page`/`pageSize` from searchParams → `clampPageSize` + `offsetFor` → call the paged query → pass `{rows,total,page,pageSize}` to the `*Views`. (Kanban still uses its own fetch — see WS3; for now kanban keeps loading its set.)
- [ ] **Step 2:** `*Views`: for table/list modes pass `pagination` into `TableView`/`ListView`. Ensure FilterBar param changes drop `page` (reset to 1) — add `page` to the keys FilterBar clears on change.
- [ ] **Step 3: Gates. Commit** `feat(deals,leads): table/list pagination`.

### Task 2.2: Contacts + Products + Forms Table/List pagination
**Files:** Modify `src/app/admin/{contacts,products,forms}/page.tsx` + their `*Views.tsx`
- [ ] **Step 1:** Same pattern: read page/pageSize, call the paged query, pass pagination to Table/List; FilterBar resets page on filter change.
- [ ] **Step 2: Gates. Commit** `feat(records): table/list pagination for contacts/products/forms`.

---

## Workstream 3: kanban-paging (Deals + Leads)

### Task 3.1: grouped counts + first-page + load-more data (TDD where pure)
**Files:** Modify `src/features/records/queries.ts`
**Produces:** `dealStageCounts(filters,ctx):Promise<Record<string,number>>` and `leadStatusCounts(filters,ctx):Promise<Record<string,number>>` (grouped count, RBAC + filters); `loadColumnRows(args:{entity:'deals'|'leads';columnId:string;offset:number;limit:number;filters;ctx}):Promise<{rows;total}>` — fetch the column's window (deals: `stage_id=columnId`; leads: `status=columnId`), RBAC scope + filters, ordered `created_at desc,id desc`.
- [ ] **Step 1:** Implement counts + `loadColumnRows`; reuse the filter/scope builder. (A unit test on the offset math / arg validation; DB round-trip is ENV-PENDING.)
- [ ] **Step 2: Gates. Commit** `feat(records): kanban per-column counts + loadColumnRows`.

### Task 3.2: KanbanBoard "Load more" + wire Deals & Leads
**Files:** Modify `src/features/views/KanbanBoard.tsx`; `src/app/admin/deals/{page.tsx,DealsViews.tsx}`; `src/app/admin/leads/{page.tsx,LeadsViews.tsx}`; add a `loadColumnRows` server action wrapper (`'use server'`, RBAC-gated) if the data fn isn't already an action.
**Produces:** KanbanBoard renders per-column footer "showing N of TOTAL" + a **Load more** button (when N<total) that calls an `onLoadMore(columnId, offset)` prop → appends rows. Deals/Leads pages: fetch first 50/column + counts, pass to KanbanBoard with `onLoadMore` wired to the server action (view-gated by the page's `requireModuleView`).
- [ ] **Step 1:** KanbanBoard: track per-column loaded rows + total; footer + Load more; append on success; keep drag working on loaded cards.
- [ ] **Step 2:** Wire Deals + Leads (counts + first page + onLoadMore). Server action asserts `requireModuleView`/permission + re-applies scope.
- [ ] **Step 3: Gates. Commit** `feat(views): kanban per-column load-more (deals+leads)`.

---

## Self-Review Notes
- Coverage: core+queries+component (WS1), Table/List wiring on all five (WS2), kanban counts+load-more (WS3). Matches spec.
- Type consistency: `PagedResult<T>`, `PAGE_SIZES`, `clampPage/clampPageSize/pageCount/offsetFor`, `<Pagination>` props, `loadColumnRows` signature identical across tasks.
- RBAC: every paged query + `loadColumnRows` re-applies scope; load-more server action gated.
- Reuse: existing `QueryPage`/`.range()`, filter/scope code, `changeDealStage`/`changeLeadStatus` for drag; no migration.
- Perf: default fetch 25 (was ≤500); kanban 50/column + counts. ENV-PENDING: live load-more + count timing verifiable against the DB/browser.
