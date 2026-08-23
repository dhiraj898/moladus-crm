/**
 * Hand-authored TypeScript types mirroring the schema in
 * supabase/migrations/0001_init.sql (spec §4).
 *
 * These unblock the build before a live Supabase project exists. Once the
 * project is connected, regenerate with:
 *   supabase gen types typescript --linked > src/lib/supabase/types.ts
 *
 * Nullability follows the DDL: columns declared without NOT NULL are typed
 * `| null` (including defaulted columns, matching `supabase gen types`).
 * `timestamptz` values are returned as ISO strings by supabase-js.
 */

/** Arbitrary JSON value stored in a jsonb column. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ---------------------------------------------------------------------------
// Enums / string unions
// ---------------------------------------------------------------------------

/** deals.payment_status */
export type PaymentStatus =
  | 'pending'
  | 'link_sent'
  | 'link_expired'
  | 'paid'
  | 'failed'
  | 'refunded'

/** stages.type */
export type StageType = 'open' | 'won' | 'lost'

/** activities.type */
export type ActivityType =
  | 'note'
  | 'stage_change'
  | 'created'
  | 'edited'
  | 'payment'
  | 'notification'

/** activities.entity_type */
export type ActivityEntity = 'lead' | 'deal' | 'contact'

/** form_fields.field_type */
export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'dropdown'
  | 'radio'
  | 'checkbox_group'
  | 'date'
  | 'statement'
  | 'yes_no'

/** products.price_mode */
export type PriceMode = 'inclusive' | 'exclusive'

/** forms.status */
export type FormStatus = 'draft' | 'published'

/** notification_log.status */
export type NotificationStatus = 'sent' | 'failed' | 'pending'

/** form_fields.binding — where an answer is routed on ingest */
export type Binding =
  | 'contact.name'
  | 'contact.email'
  | 'contact.whatsapp_number'
  | 'contact.marketing_consent'
  | 'lead.source'
  | 'lead.state'
  | 'store_only'

/** form_fields.transform — type coercion applied to an answer */
export type FieldTransform = 'string' | 'number' | 'boolean'

/** visible_when.operator */
export type VisibleWhenOperator = 'eq' | 'neq' | 'in' | 'not_in'

/** An option for dropdown/radio/checkbox_group fields (form_fields.options). */
export interface FieldOption {
  label: string
  value: string
}

// ---------------------------------------------------------------------------
// Custom fields (spec 4 — migration 0006)
// ---------------------------------------------------------------------------

/** custom_field_defs.entity_type */
export type CustomFieldEntity = 'product' | 'lead' | 'deal' | 'contact'

/** custom_field_defs.field_type — subset of FieldType reused for custom fields. */
export type CustomFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'dropdown'
  | 'radio'
  | 'checkbox_group'
  | 'date'
  | 'yes_no'

/** A single stored custom-field value. */
export type CustomFieldValue = string | number | boolean | string[] | null

/** The custom_fields JSONB payload, keyed by CustomFieldDef.key. */
export type CustomFieldValues = Record<string, CustomFieldValue>

export interface CustomFieldDef {
  id: string
  entity_type: CustomFieldEntity
  key: string
  label: string
  field_type: CustomFieldType
  required: boolean
  options: FieldOption[]
  display_order: number
  active: boolean
  created_at: string
  updated_at: string
}

/**
 * Conditional-visibility rule (form_fields.visible_when).
 * `null` on the column means the field is always visible.
 * For `in` / `not_in`, `value` is an array of strings.
 */
export interface VisibleWhen {
  field_key: string
  operator: VisibleWhenOperator
  value: string | string[]
}

// ---------------------------------------------------------------------------
// Table row types
// ---------------------------------------------------------------------------

export interface Product {
  id: string
  name: string
  code: string | null
  sac_code: string | null
  description: string | null
  base_price: number
  currency: string | null
  taxable: boolean | null
  gst_percentage: number | null
  price_mode: PriceMode | null
  active: boolean | null
  custom_fields: CustomFieldValues
  created_at: string | null
  updated_at: string | null
}

export interface Form {
  id: string
  name: string
  slug: string
  product_id: string | null
  status: FormStatus | null
  welcome_message: string | null
  submit_label: string | null
  hide_price: boolean
  created_at: string | null
  updated_at: string | null
}

export interface FormField {
  id: string
  form_id: string | null
  key: string
  label: string
  field_type: FieldType
  required: boolean | null
  display_order: number
  options: FieldOption[] | null
  placeholder: string | null
  binding: Binding | null
  transform: FieldTransform | null
  visible_when: VisibleWhen | null
}

export interface Lead {
  id: string
  form_id: string | null
  product_id: string | null
  name: string | null
  email: string | null
  phone: string | null
  state: string | null
  source: string | null
  utm: Json | null
  status: string | null
  owner_id: string | null
  raw_payload: Json
  custom_fields: CustomFieldValues
  created_at: string | null
}

export interface Contact {
  id: string
  lead_id: string | null
  name: string | null
  email: string | null
  whatsapp_number: string
  marketing_consent: boolean | null
  consent_timestamp: string | null
  tags: string[] | null
  custom_fields: CustomFieldValues
  created_at: string | null
}

export interface Deal {
  id: string
  lead_id: string | null
  contact_id: string | null
  product_id: string | null
  base_amount: number
  taxable_amount: number
  cgst: number | null
  sgst: number | null
  igst: number | null
  total_amount: number
  place_of_supply: string | null
  stage_id: string | null
  owner_id: string | null
  stage_entered_at: string | null
  payment_status: PaymentStatus | null
  razorpay_payment_link_id: string | null
  razorpay_payment_link_url: string | null
  razorpay_ref: string | null
  custom_fields: CustomFieldValues
  created_at: string | null
  updated_at: string | null
}

export interface NotificationLog {
  id: string
  deal_id: string | null
  channel: string | null
  template: string
  status: NotificationStatus | null
  sent_at: string | null
  error_message: string | null
}

export interface WebhookEvent {
  id: string
  provider: string | null
  event_id: string | null
  payload: Json
  processed: boolean | null
  received_at: string | null
  processed_at: string | null
}

export interface Stage {
  id: string
  name: string
  display_order: number
  type: StageType
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface DealStageEvent {
  id: string
  deal_id: string
  stage_id: string
  actor_id: string | null
  entered_at: string
}

export interface Activity {
  id: string
  entity_type: ActivityEntity
  entity_id: string
  type: ActivityType
  actor_id: string | null
  body: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Workflow automation (spec 2 — migration 0004)
// ---------------------------------------------------------------------------

/** Comparison operators for a condition predicate. */
export type ConditionOp = 'eq' | 'neq' | 'in' | 'not_in' | 'is_empty' | 'not_empty'

/**
 * A single `{field, op, value}` predicate evaluated against a context object
 * (form answers for entry rules, the deal row for SLA rules). `value` is
 * unused for `is_empty`/`not_empty`, and an array for `in`/`not_in`.
 */
export interface Condition {
  field: string
  op: ConditionOp
  value?: unknown
}

/** stage_actions.action_type — on-enter actions (never move_stage). */
export type StageActionType = 'send_whatsapp' | 'create_payment_link'

/** sla_rules.action_type — time-based actions (may move stage). */
export type SlaActionType = 'send_whatsapp' | 'move_stage'

export interface EntryRule {
  id: string
  condition: Condition | null
  to_stage_id: string
  priority: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface StageAction {
  id: string
  stage_id: string
  action_type: StageActionType
  config: Record<string, unknown>
  run_order: number
  active: boolean
  created_at: string
}

export interface SlaRule {
  id: string
  from_stage_id: string
  delay_minutes: number
  condition: Condition | null
  action_type: SlaActionType
  config: Record<string, unknown>
  active: boolean
  created_at: string
}

export interface AutomationRun {
  id: string
  deal_id: string
  sla_rule_id: string
  stage_entered_at: string
  fired_at: string
}

// ---------------------------------------------------------------------------
// RBAC (spec 3 — migration 0005)
// ---------------------------------------------------------------------------

/** Every gated admin module. */
export type ModuleKey =
  | 'products'
  | 'forms'
  | 'leads'
  | 'deals'
  | 'contacts'
  | 'settings'
  | 'automation'

/** A single capability within a module. */
export type Capability = 'view' | 'edit'

/** Record visibility scope for the record modules (leads, deals). */
export type RecordScope = 'all' | 'own'

/** view/edit for a plain module. */
export interface ModulePermission {
  view: boolean
  edit: boolean
}

/** view/edit + scope for the record modules. */
export interface ScopedModulePermission extends ModulePermission {
  scope: RecordScope
}

/** The full per-module matrix stored in roles.permissions. */
export interface Permissions {
  products: ModulePermission
  forms: ModulePermission
  leads: ScopedModulePermission
  deals: ScopedModulePermission
  contacts: ModulePermission
  settings: ModulePermission
  automation: ModulePermission
}

export interface Role {
  id: string
  name: string
  permissions: Permissions
  in_assignment_pool: boolean
  is_system: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  user_id: string
  role_id: string | null
  created_at: string
  updated_at: string
}

export interface AssignmentState {
  key: string
  last_user_id: string | null
  updated_at: string
}
