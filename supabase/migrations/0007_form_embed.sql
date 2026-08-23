-- 0007_form_embed.sql — Form Embed (Spec 5). Apply out-of-band.

-- Per-form toggle: when true, the public form (/f/[slug]) hides the product
-- cost estimate in its header. Pricing/GST + payment amounts are unaffected.
alter table forms
  add column if not exists hide_price boolean not null default false;
