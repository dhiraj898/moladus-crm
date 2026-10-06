# Admin Dashboard — Design Spec

**Date:** 2026-10-06
**Branch:** `worktree-feat+dashboard`
**Status:** Approved for planning

## Goal

An admin analytics dashboard surfacing pipeline, revenue, lead acquisition, and
operational health, built from data already in the CRM. Read-only in v1.

## Locked decisions

| Decision | Choice |
|---|---|
| Route | **New** `src/app/admin/dashboard/`. `/admin` keeps its existing redirect unchanged. |
| Access | Every authenticated admin. No RBAC scoping, no new permission module. |
| Charts | `@tremor/react` (Tailwind v3.4 + config file already present). |
| Revenue definition | **Gross booked** = paid + pending, split visually. |
| KPI deltas | Period-over-period deltas on headline KPIs (revenue, new leads, deals won). |
| Date range | Presets `7d / 30d / 90d / ytd / all` **plus** custom `from`/`to` pickers. Default `30d`. |
| Stale deals | Open deals with `stage_entered_at` older than **14 days**. |
| Panels (v1) | Revenue · Pipeline · Leads/Acquisition · Activity/Ops. |

## Architecture

- **Page:** `src/app/admin/dashboard/page.tsx` — server component, `export const dynamic = 'force-dynamic'`. Gated by the existing `/admin` auth gate only (reuse whatever the admin layout already requires; no module guard).
- **Data access:** `src/features/dashboard/queries.ts` — `import 'server-only'`, `getServiceClient()`, mirroring `features/records/queries.ts`. One exported function per metric group; each takes a resolved date window and returns plain, serializable, empty-safe shapes.
- **Client rendering:** `src/app/admin/dashboard/DashboardViews.tsx` — client component, owns all Tremor components. Receives only plain aggregates (no Supabase client crosses the boundary).
- **Migration:** `supabase/migrations/0012_dashboard_views.sql` — read-only SQL views. Regenerate `src/lib/supabase/types` if types are generated.
- **Nav:** `AdminNav.tsx` gets an always-visible **Dashboard** item (special-cased like `settings`, not keyed to a module permission) linking to `/admin/dashboard`.

### Aggregation strategy — daily-grain views + JS windowing

Views emit **one row per day** (and per dimension where relevant). The query
layer pulls the span `[prevWindowStart → currentEnd]` once per metric and sums
current vs previous windows in JS. One row per day is trivial to process, any
date range works (incl. custom / YTD / all), and period-over-period deltas fall
out of the same pull. Current-snapshot aggregates (pipeline by stage, stale
deals) are small `GROUP BY` views filtered by the current window only.

## Data flow

1. Page reads `?range=` (one of `7d|30d|90d|ytd|all`) **or** `?from=&to=`.
2. `resolveRange(params)` → `{ currentStart, currentEnd, prevStart }`.
   - `prevStart` = `currentStart − (currentEnd − currentStart)` so the previous
     window is equal-length. For `all`, deltas are omitted (no prior window).
3. `Promise.all` of the query functions over that window.
4. Plain aggregates handed to `DashboardViews`.

## SQL views (`0012_dashboard_views.sql`)

All read-only. Daily views key off `date_trunc('day', <ts>)` as `day`.

| View | Grain | Columns |
|---|---|---|
| `v_revenue_daily` | day × status bucket | day, bucket (`paid`/`pending`), sum(total_amount), sum(cgst+sgst+igst) as gst |
| `v_revenue_by_product` | day × product × bucket | day, product_name, bucket, sum(total_amount) — from `deal_items` joined to `deals` |
| `v_leads_daily` | day | day, count |
| `v_leads_by_source` | day × source | day, source (null → `direct`), count |
| `v_leads_by_form` | day × form | day, form_name, count |
| `v_lead_conversion` | day | day, leads, leads_with_deal |
| `v_pipeline_by_stage` | snapshot | stage name, type (`open`/`won`/`lost`), display_order, count, sum(total_amount) |
| `v_stage_velocity` | snapshot | stage name, avg_days_in_stage (from `deal_stage_events` consecutive entries) |
| `v_stale_deals` | row-per-deal | deal_id, stage name, total_amount, stage_entered_at, days_stale |

Revenue "bucket" maps `payment_status`: `paid` → `paid`; `pending`/`link_sent`
→ `pending`. `refunded`/`failed`/`link_expired` are excluded from booked revenue.

## Panels & components

### Revenue
- KPI tiles: **Gross booked**, **Paid**, **Pending** — each with prev-period delta (except `all`).
- Stacked `AreaChart`: paid vs pending over time.
- `BarList`: revenue by product.
- GST summary tile (sum of cgst+sgst+igst over paid).

### Pipeline
- `BarChart` deals-by-stage: count and booked value, ordered by `display_order`.
- Win-rate tile: `won / (won + lost)`.
- `BarChart` stage velocity: avg days in stage.

### Leads / Acquisition
- KPI tile: new leads + delta.
- `LineChart`: leads per day.
- `DonutChart`: leads by source.
- `BarList`: leads by form.
- Conversion tile: `leads_with_deal / leads`.

### Activity / Ops
- Recent `activities` feed (latest 15, newest first).
- Stale-deals table: open deals, `days_stale > 14`, sorted oldest first.
- Notifications-sent count over the window (from `notification_log`).

## Error handling

Each query function returns typed, empty-safe shapes (`[]` / `0`) so a sparse or
future-dated range renders empty states rather than crashing. Page stays
`force-dynamic`; no caching of per-range results in v1.

## Testing

Pure helpers extracted and unit-tested with the existing Vitest setup:
- `resolveRange(params) → { currentStart, currentEnd, prevStart }` — presets, custom, `all` (no prev), invalid input → default 30d.
- `winRate(won, lost)` — incl. zero-denominator guard.
- `conversionRate(leads, withDeal)` — incl. zero-denominator guard.
- current-vs-previous windowing reducer over daily rows.
- One empty-safe shape assertion per view-query function.

No new test framework or fixtures.

## Tremor/Tailwind integration (the one real wrinkle)

`tailwind.config.ts`:
- Add Tremor content glob (`./node_modules/@tremor/**/*.{js,ts,jsx,tsx}`).
- `darkMode: ['selector', '[data-theme="dark"]']` — project themes via
  `[data-theme]`, Tremor expects a class selector; this reconciles them.
- Map Tremor brand/background/content colors to existing tokens
  (`brand → #ff4500`, surfaces → `--surface`/`--surface2`, text → `--text`).

Verify light + dark visually in preview before completion.

## Deliberate simplifications (ponytail)

- Views + PostgREST filtering + JS windowing instead of parameterized RPCs.
  Upgrade to SQL functions only if timezone-aware bucketing is needed.
- No per-user revenue scoping (admin-wide, per decision). Add an owner filter if
  agents ever get dashboard access.
- v1 read-only: no saved views, CSV export, or drill-down. Add when asked.
- No result caching; `force-dynamic` per request is fine at current data volume.

## Out of scope (v1)

Saved/custom dashboards, exports, drill-down navigation, per-agent scoping,
real-time updates, forecasting.
