# Admin Dashboard — Implementation Plan

**Branch:** `worktree-feat+dashboard` · **Route:** `/admin` (becomes the landing page)

## Decisions (locked)
- **Charts:** `@tremor/react` (Tailwind v3.4 + config file already present — native fit).
- **Access:** every authenticated admin (no RBAC scoping). Reuses the existing `/admin` auth gate; no new module, no migration for permissions.
- **Panels (v1):** Pipeline · Revenue · Leads/Acquisition · Activity/Ops.

## Data source map (all data already exists)
| Panel | Source |
|---|---|
| Pipeline | `deals` + `stages` (type open/won/lost), funnel/velocity from `deal_stage_events` |
| Revenue | `deals.total_amount` where `payment_status='paid'`, split by `deal_items.product_name`, GST cols |
| Leads | `leads` by `created_at` / `source` / `utm` / `form_id` / `product_id`; lead→deal join |
| Activity | `activities` feed, stale open deals via `deals.stage_entered_at`, `notification_log` |

## Architecture — mirrors existing `features/records/queries.ts`
Server-only queries via `getServiceClient()`, aggregation pushed into **read-only SQL views** (don't pull raw rows into JS). Page is a server component; Tremor renders in a client child.

## Tasks
1. **Migration `0012_dashboard_views.sql`** — read-only views with date columns for PostgREST range filtering (`.gte/.lte` from URL):
   - `v_pipeline_by_stage` (stage, type, count, value)
   - `v_stage_velocity` (avg days-in-stage from `deal_stage_events`)
   - `v_revenue_daily`, `v_revenue_by_product`, `v_revenue_totals` (paid/pending/GST)
   - `v_leads_daily`, `v_leads_by_source`, `v_leads_by_form`, `v_lead_conversion`
   - `v_stale_deals` (open deals, `stage_entered_at` age)
   - Regenerate `lib/supabase/types` if types are generated.
2. **Tremor install + theming** — `npm i @tremor/react`; add tremor content path + brand palette in `tailwind.config.ts` mapped to tokens (`brand → #ff4500`, bg/content → `--surface`/`--text`). **Reconcile dark mode:** project themes via `[data-theme]`, Tremor expects `darkMode: 'class'` → set `darkMode: ['selector','[data-theme="dark"]']`. *(ponytail: this is the one real integration wrinkle — verify in preview.)*
3. **`features/dashboard/queries.ts`** — one function per view, each taking `{from, to}`; plus pure math helpers (`winRate`, `conversionRate`) for unit testing.
4. **Date-range control** — URL-driven (`?range=30d` / `from` / `to`), default last 30 days, reusing the leads filter-in-URL pattern.
5. **`DashboardViews` client component** — Tremor `Card`/`BarChart`/`AreaChart`/`DonutChart`/`BarList` + KPI tiles, grouped into the 4 panels.
6. **Page `src/app/admin/page.tsx`** — replace current redirect with the dashboard; `Promise.all` the queries. Add always-visible **Dashboard** nav item in `AdminNav.tsx` (special-cased like `settings`).
7. **Tests** — one aggregation/shape test + the math helpers (win rate, conversion). No new framework (uses existing Vitest).
8. **Verify** — `preview_start`, screenshot light + dark, check console/network clean.

## Deliberate simplifications
- Views + PostgREST filters instead of parameterized RPCs — simpler, good enough for these aggregates. Upgrade to SQL functions only if date-bucketing needs timezone params.
- No per-user revenue scoping (admin-wide, per your call). Add an owner filter later if agents get dashboard access.
- v1 is read-only; no saved views / exports / drill-down (add when asked).
