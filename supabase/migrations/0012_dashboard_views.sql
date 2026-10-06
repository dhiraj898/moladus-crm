-- 0012_dashboard_views.sql — Admin dashboard read-only views (design spec §51).
-- Daily views key off date_trunc('day', <ts>) as day; query layer windows in JS.
-- Revenue bucket maps payment_status: paid -> paid; pending/link_sent -> pending.
-- refunded/failed/link_expired are excluded from booked revenue.

-- Revenue per day x bucket.
create or replace view v_revenue_daily with (security_invoker = true) as
select
  date_trunc('day', created_at) as day,
  case when payment_status = 'paid' then 'paid' else 'pending' end as bucket,
  sum(total_amount) as total_amount,
  sum(coalesce(cgst, 0) + coalesce(sgst, 0) + coalesce(igst, 0)) as gst
from deals
where payment_status in ('paid', 'pending', 'link_sent')
group by 1, 2;

-- Revenue per day x product x bucket (from order line items).
create or replace view v_revenue_by_product with (security_invoker = true) as
select
  date_trunc('day', d.created_at) as day,
  di.product_name,
  case when d.payment_status = 'paid' then 'paid' else 'pending' end as bucket,
  sum(di.total_amount) as total_amount
from deal_items di
join deals d on d.id = di.deal_id
where d.payment_status in ('paid', 'pending', 'link_sent')
group by 1, 2, 3;

-- New leads per day.
create or replace view v_leads_daily with (security_invoker = true) as
select date_trunc('day', created_at) as day, count(*) as count
from leads
group by 1;

-- Leads per day x source (null/empty source -> 'direct').
create or replace view v_leads_by_source with (security_invoker = true) as
select
  date_trunc('day', created_at) as day,
  coalesce(nullif(source, ''), 'direct') as source,
  count(*) as count
from leads
group by 1, 2;

-- Leads per day x form.
create or replace view v_leads_by_form with (security_invoker = true) as
select
  date_trunc('day', l.created_at) as day,
  coalesce(f.name, 'Unknown') as form_name,
  count(*) as count
from leads l
left join forms f on f.id = l.form_id
group by 1, 2;

-- Lead -> deal conversion per day.
create or replace view v_lead_conversion with (security_invoker = true) as
select
  date_trunc('day', l.created_at) as day,
  count(*) as leads,
  count(*) filter (where exists (select 1 from deals d where d.lead_id = l.id)) as leads_with_deal
from leads l
group by 1;

-- Pipeline snapshot: deals grouped by stage (empty stages show 0).
create or replace view v_pipeline_by_stage with (security_invoker = true) as
select
  s.name as stage,
  s.type,
  s.display_order,
  count(d.id) as count,
  coalesce(sum(d.total_amount), 0) as total_amount
from stages s
left join deals d on d.stage_id = s.id
group by s.name, s.type, s.display_order;

-- Stage velocity: avg days between consecutive stage entries, per stage.
create or replace view v_stage_velocity with (security_invoker = true) as
with intervals as (
  select
    stage_id,
    lead(entered_at) over (partition by deal_id order by entered_at) - entered_at as duration
  from deal_stage_events
)
select
  s.name as stage,
  avg(extract(epoch from i.duration) / 86400.0) as avg_days_in_stage
from intervals i
join stages s on s.id = i.stage_id
where i.duration is not null
group by s.name;

-- Stale deals: open deals with their time-in-stage (14d threshold applied in query layer).
create or replace view v_stale_deals with (security_invoker = true) as
select
  d.id as deal_id,
  s.name as stage,
  d.total_amount,
  d.stage_entered_at,
  extract(epoch from (now() - d.stage_entered_at)) / 86400.0 as days_stale
from deals d
join stages s on s.id = d.stage_id
where s.type = 'open';
