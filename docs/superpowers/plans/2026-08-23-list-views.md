# List Views (Kanban / Table / List) + Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A reusable view framework giving every admin record list a Kanban/Table/List switcher with search + filters; Kanban (drag-to-move) for Deals (by stage) and Leads (by status).

**Architecture:** `src/features/views/` holds shared components (`ViewSwitcher`, `FilterBar`, `TableView`, `ListView`, `KanbanBoard`) + a `useViewMode` hook, driven by a per-entity `ListViewConfig`. List pages fetch RBAC-scoped, filtered rows server-side and render the active view. Kanban drag calls `changeDealStage` / `changeLeadStatus` optimistically.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, @dnd-kit/core + @dnd-kit/sortable, Supabase service-role, Vitest, Tailwind design tokens.

## Global Constraints
- Server-side filtering/search via `getServiceClient()` in server-only queries; **respect RBAC scope** (leads/deals own-vs-all) — reuse the existing `ownerScopeFilter`/ctx pattern.
- Mutations (`changeLeadStatus`) assert `requirePermission('leads','edit')` + own-scope IDOR re-check (mirror `changeDealStage`).
- View preference: `?view=` URL param (shareable) + `localStorage` per-entity default. Filters live in URL query params.
- Design system: Inter, dark-default tokens, `--accent:#ff4500`, CSS vars, row-border tables, chips, `tabular-nums` on money — match existing admin screens.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test`). Never `npm run dev` in a gate. No migration.

## File Structure
- Create: `src/features/views/{types.ts, useViewMode.ts, useViewMode.test.ts, ViewSwitcher.tsx, FilterBar.tsx, TableView.tsx, ListView.tsx, KanbanBoard.tsx, group.ts, group.test.ts}`
- Modify: `src/features/crm/leads/actions.ts` (+`changeLeadStatus`); `src/features/records/queries.ts` (extend list filters); add filtered list queries for products/forms/contacts (in their feature dirs or records queries).
- Modify list pages: `src/app/admin/{deals,leads,contacts,products,forms}/page.tsx` (+ small client wrappers where needed).
- `package.json` — add `@dnd-kit/core`, `@dnd-kit/sortable`.

---

## Workstream 1: view-framework (switcher, hook, filter bar, table, list)

### Task 1.1: types + useViewMode (TDD)
**Files:** Create `src/features/views/types.ts`, `useViewMode.ts`, `useViewMode.test.ts`
**Produces:** `type ViewMode='kanban'|'table'|'list'`; `interface ColumnDef<T>{key;header;render:(row:T)=>ReactNode;align?:'left'|'right';sortable?:boolean}`; `interface CardDef<T>{title;subtitle?;meta?:(row:T)=>{label:string;tone?:'dim'|'accent'|'green'|'red'|'amber'}[];href:(row:T)=>string}`; `interface FilterDef{key;label;type:'search'|'select'|'date';options?:{label;value}[]}`; `interface ListViewConfig<T>{entity:string;modes:ViewMode[];columns:ColumnDef<T>[];card:CardDef<T>;filters:FilterDef[];groupBy?:{options:{id:string;label:string;tone?:string}[]}}`; `resolveViewMode(urlValue:string|null, stored:string|null, modes:ViewMode[]):ViewMode` (URL if valid+supported → stored if valid+supported → modes[0]).
- [ ] **Step 1: Test** `useViewMode.test.ts` for `resolveViewMode`: valid URL wins; invalid URL falls to stored; unsupported stored falls to modes[0]; empty→modes[0].
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** types.ts + `resolveViewMode` (pure) + `useViewMode(entity, modes)` client hook (reads `useSearchParams().get('view')` + `localStorage['view:'+entity]`, writes both on change, returns `[mode, setMode]`).
- [ ] **Step 4: Run — PASS.** **Commit** `feat(views): view-mode types + resolver`.

### Task 1.2: ViewSwitcher + FilterBar
**Files:** Create `ViewSwitcher.tsx`, `FilterBar.tsx`
**Produces:** `<ViewSwitcher entity modes value onChange />` (segmented control, only supported modes, accent active); `<FilterBar filters values />` (client): renders search input (debounced) + selects + date inputs, pushes changes to URL query params via `useRouter().replace`, plus a Reset link. Only filter keys present in `filters` render.
- [ ] **Step 1:** Implement both with design tokens; ViewSwitcher icons/labels per mode (Kanban/Table/List); FilterBar maps each `FilterDef` to a control and syncs the querystring.
- [ ] **Step 2: Gates** (lint+type-check+build). **Commit** `feat(views): ViewSwitcher + FilterBar`.

### Task 1.3: TableView + ListView
**Files:** Create `TableView.tsx`, `ListView.tsx`
**Produces:** `<TableView columns rows />` (row-border table; each row links via a column or a row wrapper to the detail; `tabular-nums` where a column sets align:right for money; empty state); `<ListView card rows />` (roomy card rows: title, subtitle, meta chips; links to detail; empty state). Both generic over `T`.
- [ ] **Step 1:** Implement both from the config; design tokens; empty states.
- [ ] **Step 2: Gates.** **Commit** `feat(views): generic TableView + ListView`.

---

## Workstream 2: kanban (board + drag + changeLeadStatus)

### Task 2.1: grouping helper (TDD)
**Files:** Create `group.ts`, `group.test.ts`
**Produces:** `groupRows<T>(rows:T[], getColumnId:(row:T)=>string|null, columns:{id:string}[]):Record<string,T[]>` — buckets each row by its column id; rows whose id is null/unknown go to a synthetic `'__unassigned'` bucket; every declared column id present (even if empty).
- [ ] **Step 1: Test** — rows distribute to correct columns; empty columns present; unknown/null → `__unassigned`.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: PASS.** **Commit** `feat(views): kanban grouping helper + tests`.

### Task 2.2: changeLeadStatus action
**Files:** Modify `src/features/crm/leads/actions.ts`
**Produces:** `changeLeadStatus(leadId:string, status:LeadStatus):Promise<ActionResult<void>>` — `requirePermission('leads','edit')`; if scope is 'own' re-read `leads.owner_id` and reject `'Not found'` when `!== ctx.user.id` (mirror deal edits); validate `status` ∈ `LEAD_STATUSES`; update `leads.status`; `logActivity('lead', leadId, 'edited', {actorId: ctx.user.id, metadata:{status}})`; `revalidatePath('/admin/leads')`.
- [ ] **Step 1: Implement** following the `changeDealStage` pattern (`src/features/crm/deals/actions.ts`).
- [ ] **Step 2: Gates + test** (add a mocked unit test asserting own-scope reject + update + activity). **Commit** `feat(leads): changeLeadStatus with own-scope guard`.

### Task 2.3: KanbanBoard component
**Files:** Create `KanbanBoard.tsx`; `package.json` (+@dnd-kit)
**Produces:** `<KanbanBoard columns cards card onMove />` where `onMove(cardId, toColumnId): Promise<{ok:boolean;error?:string}>`. Uses `@dnd-kit/core` `DndContext` + droppable columns + draggable cards; horizontal-scroll column layout; each card rendered from the `CardDef`; on drop → optimistic move in local state → `await onMove` → rollback + inline error on failure. Pointer + keyboard sensors. Design tokens (columns = `--surface`, cards = `--surface2`, count badges).
- [ ] **Step 1:** `npm i @dnd-kit/core @dnd-kit/sortable`.
- [ ] **Step 2:** Implement the board (optimistic + rollback).
- [ ] **Step 3: Gates.** **Commit** `feat(views): KanbanBoard with dnd-kit drag`.

---

## Workstream 3: deals + leads pages (all three views)

### Task 3.1: Deals page
**Files:** Modify `src/app/admin/deals/page.tsx`; add `src/app/admin/deals/DealsViews.tsx` (client) + extend `listDeals` filters in `src/features/records/queries.ts`
**Produces:** Deals list with ViewSwitcher (kanban/table/list), FilterBar (search, payment_status, stage, date range; owner when RBAC all-scope), and Kanban grouped by stage where drop → `changeDealStage`.
- [ ] **Step 1:** Extend `listDeals(ctx, filters)` to accept search + stage + payment_status + date range + sort, keeping the existing scope filter; return rows shaped for the config (incl. stage_id/stage_name).
- [ ] **Step 2:** Build the Deals `ListViewConfig` (columns, card, filters, groupBy = stages passed from the page). `page.tsx` (server): resolve ctx, load stages + filtered deals, render `<DealsViews>`.
- [ ] **Step 3:** `DealsViews` (client): `useViewMode('deals',['kanban','table','list'])`; render ViewSwitcher + FilterBar + the active view; Kanban `onMove` = `changeDealStage`.
- [ ] **Step 4: Gates + Commit** `feat(deals): kanban/table/list views + filters`.

### Task 3.2: Leads page
**Files:** Modify `src/app/admin/leads/page.tsx`; add `src/app/admin/leads/LeadsViews.tsx`; extend `searchLeads` filters
**Produces:** Leads list with the three views; Kanban grouped by `LEAD_STATUSES` where drop → `changeLeadStatus`.
- [ ] **Step 1:** Extend `searchLeads(ctx, filters)` with status + product/form + date + sort (keep scope filter).
- [ ] **Step 2:** Leads `ListViewConfig` (groupBy = LEAD_STATUSES). `page.tsx` loads filtered leads; `<LeadsViews>` wires views; Kanban `onMove` = `changeLeadStatus`.
- [ ] **Step 3: Gates + Commit** `feat(leads): kanban/table/list views + filters`.

---

## Workstream 4: contacts + products + forms pages (Table + List + filters)

### Task 4.1: Filtered list queries
**Files:** Modify `src/features/records/queries.ts` (or the feature dirs) — add `listContactsFiltered(search, consent)`, `listProductsFiltered(search, active)`, `listFormsFiltered(search, status, productId)` (server-only).
- [ ] **Step 1:** Implement the three filtered queries returning rows for the configs.
- [ ] **Step 2: Gates + Commit** `feat(records): filtered list queries for contacts/products/forms`.

### Task 4.2: Wire the three pages
**Files:** Modify `src/app/admin/{contacts,products,forms}/page.tsx`; add a small `*Views.tsx` client wrapper each
**Produces:** Each list with ViewSwitcher (table/list — no kanban), FilterBar per the entity config, TableView + ListView.
- [ ] **Step 1:** Build each entity's `ListViewConfig` (columns/card/filters per the design's Per-entity section). `page.tsx` loads filtered rows; the `*Views` client wrapper renders switcher + filter bar + active view.
- [ ] **Step 2: Gates + Commit** `feat(records): table/list views + filters for contacts/products/forms`.

---

## Self-Review Notes
- Coverage: framework (WS1), kanban+changeLeadStatus (WS2), deals+leads incl kanban (WS3), other three (WS4). All design sections mapped.
- Type consistency: `ViewMode`, `ListViewConfig<T>`, `ColumnDef`/`CardDef`/`FilterDef`, `resolveViewMode`, `groupRows`, `changeLeadStatus`, `onMove` signatures identical across WS.
- RBAC: list queries keep the existing scope filter; `changeLeadStatus` mirrors deal own-scope IDOR guard.
- Reuse: `changeDealStage` (existing) for deal moves; `logActivity`; existing records queries extended, not rewritten.
- No migration; `leads.status` + `stages` already exist.
- ENV-PENDING: none new (all verifiable locally against the live DB); Kanban drag is browser-verifiable.
