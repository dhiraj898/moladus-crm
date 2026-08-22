# Custom Fields (Spec 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow superpowers:test-driven-development for the validation helper (tests first).

**Goal:** Let an admin define extra fields (label, type, required, options) per entity — Product, Lead, Deal, Contact — in Settings, and have those fields render on each entity's detail page and inside its create/edit form, with values validated, coerced, and stored per record. Filtering by custom fields is out of scope for v1.

**Architecture:** Extends the merged v1 + Spec 1 Next.js 15 + Supabase app. One new `custom_field_defs` table describes admin-defined fields; each of `products`/`leads`/`deals`/`contacts` gains a `custom_fields jsonb not null default '{}'` column holding values keyed by `def.key`. A single pure helper (`validateCustomFields`) validates/coerces a values object against the active defs. Two shared components — `CustomFieldsCard` (detail, server) and `CustomFieldInputs` (form, client) — render fields. Each entity's create/edit action loads active defs, validates, and merges `custom_fields` into the write. Admin config lives at `/admin/settings/custom-fields`. All DB access is via the service-role client in server actions; each mutation asserts `getCurrentUser()`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS, Zod, Vitest, Tailwind (design tokens).

## Global Constraints

- Node 20+; Next.js 15 App Router; TypeScript strict.
- Supabase accessed ONLY server-side via `SUPABASE_SERVICE_ROLE_KEY` (`getServiceClient()` in `src/lib/supabase/server.ts`). RLS deny-all on the new `custom_field_defs` table.
- Every mutating server action calls `getCurrentUser()` (`src/lib/supabase/auth.ts`) first and returns `{ ok:false, error: UNAUTHENTICATED }` if null. This per-action check is the effective authorization boundary.
- `ActionResult<T> = { ok:true; data:T } | { ok:false; error:string; fieldErrors?: Record<string, string[]> }` — reuse the existing per-feature definition.
- Custom-field values live in the entity's `custom_fields` JSONB keyed by `def.key`. Only keys with a real value are stored (optional-blank fields are omitted).
- Do NOT hard-depend on Spec 3 (RBAC). Assume `0005` may or may not be applied. Custom-fields config lives under Settings; enforce only the existing `getCurrentUser()` boundary. Add no RBAC-specific code.
- Design system: Inter only, dark-default tokens, `--accent:#ff4500`, colours via CSS vars, row-border-only tables, `tabular-nums` on numbers. Match `StagesEditor`, `FieldRow`, and the existing detail/form pages.
- Field-type vocabulary is the forms subset: `short_text`, `long_text`, `number`, `dropdown`, `radio`, `checkbox_group`, `date`, `yes_no` (names match `src/features/forms/schema.ts`).
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist).
- Never run `npm run dev` or any long-running server in a gate.
- Migrations are SQL files under `supabase/migrations/`; applied out-of-band (do NOT run them against a DB in a gate). The build must stay green without applying them (types are hand-authored). Guard non-idempotent statements; this feature has **no seed data**.

---

## File Structure

- `supabase/migrations/0006_custom_fields.sql` — `custom_field_defs` table (RLS deny-all) + `custom_fields jsonb` on products/leads/deals/contacts. No seed.
- `src/lib/supabase/types.ts` — add `CustomFieldEntity`, `CustomFieldType`, `CustomFieldValue`, `CustomFieldValues`, `CustomFieldDef`; add `custom_fields: CustomFieldValues` to `Product`, `Lead`, `Deal`, `Contact`.
- `src/features/crm/custom-fields/schema.ts` — enums + `customFieldDefSchema` + `CustomFieldDefInput(Raw)`.
- `src/features/crm/custom-fields/validate.ts` — `validateCustomFields` + `toFieldErrors` + `CF_ERROR_PREFIX`.
- `src/features/crm/custom-fields/validate.test.ts` — unit tests for `validateCustomFields`.
- `src/features/crm/custom-fields/queries.ts` — `listCustomFieldDefs`, `getActiveCustomFieldDefs`.
- `src/features/crm/custom-fields/actions.ts` — def CRUD server actions.
- `src/features/crm/custom-fields/CustomFieldsCard.tsx` — shared detail render (server).
- `src/features/crm/custom-fields/CustomFieldInputs.tsx` — shared form inputs (client).
- `src/app/admin/settings/custom-fields/{page.tsx,CustomFieldsEditor.tsx,CustomFieldDefRow.tsx}` — Settings admin UI.
- `src/app/admin/settings/SettingsNav.tsx` — add "Custom Fields" nav entry (modify).
- Per-entity wiring (exemplar = Lead; repeat for Contact, Deal, Product):
  - `src/features/crm/leads/{schema.ts,actions.ts}` — accept + persist `custom_fields`.
  - `src/app/admin/leads/LeadForm.tsx` — render `CustomFieldInputs`.
  - `src/app/admin/leads/[id]/page.tsx` — render `CustomFieldsCard`.
  - `src/app/admin/leads/new/page.tsx`, `src/app/admin/leads/[id]/edit/page.tsx` — load active defs.

---

## Workstream 1: db (migration + types)

### Task 1.1: Migration `0006_custom_fields.sql`

**Files:**

- Create: `supabase/migrations/0006_custom_fields.sql`

**Interfaces:**

- Produces (DB): table `custom_field_defs` (RLS deny-all, unique `(entity_type, key)`, order index); `custom_fields jsonb not null default '{}'` on `products`, `leads`, `deals`, `contacts`. No seed.

- [ ] **Step 1: Write the migration** (verbatim):

```sql
-- 0006_custom_fields.sql — Custom Fields (Spec 4). Apply via Supabase SQL editor / db push.

create table if not exists custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('product','lead','deal','contact')),
  key text not null,
  label text not null,
  field_type text not null check (field_type in (
    'short_text','long_text','number','dropdown','radio','checkbox_group','date','yes_no'
  )),
  required boolean not null default false,
  options jsonb not null default '[]',
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table custom_field_defs enable row level security;
create unique index if not exists custom_field_defs_entity_key
  on custom_field_defs (entity_type, key);
create index if not exists custom_field_defs_entity_order
  on custom_field_defs (entity_type, display_order);

alter table products add column if not exists custom_fields jsonb not null default '{}';
alter table leads    add column if not exists custom_fields jsonb not null default '{}';
alter table deals    add column if not exists custom_fields jsonb not null default '{}';
alter table contacts add column if not exists custom_fields jsonb not null default '{}';
```

- [ ] **Gate:** no build impact (SQL only). Confirm the file exists and is well-formed. Do NOT apply it in a gate.
- [ ] **Commit:** `feat(custom-fields): add 0006 migration (custom_field_defs + custom_fields columns)`

### Task 1.2: TypeScript types

**Files:**

- Modify: `src/lib/supabase/types.ts`

**Interfaces:**

- Adds `CustomFieldEntity`, `CustomFieldType`, `CustomFieldValue`, `CustomFieldValues`, `CustomFieldDef`; adds `custom_fields: CustomFieldValues` to `Product`, `Lead`, `Deal`, `Contact`.

- [ ] **Step 1:** Add the type block (place near `FieldOption`, which is reused):

```ts
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
```

- [ ] **Step 2:** Add `custom_fields: CustomFieldValues` to each of `Product`, `Lead`, `Deal`, `Contact` interfaces.
- [ ] **Gate:** `npm run lint && npm run type-check && npm run build`.
- [ ] **Commit:** `feat(custom-fields): add hand-authored types`

---

## Workstream 2: validation helper (TDD)

### Task 2.1: `validateCustomFields` + tests

Follow superpowers:test-driven-development — write `validate.test.ts` first (red), then `validate.ts` (green).

**Files:**

- Create: `src/features/crm/custom-fields/validate.ts`
- Create: `src/features/crm/custom-fields/validate.test.ts`

**Interfaces:**

```ts
export const CF_ERROR_PREFIX = 'cf:'

export type CustomFieldValidationResult =
  | { ok: true; values: CustomFieldValues; errors: Record<string, string> }
  | { ok: false; values: CustomFieldValues; errors: Record<string, string> }

export function validateCustomFields(
  entityType: CustomFieldEntity,
  defs: CustomFieldDef[],
  input: Record<string, unknown>
): CustomFieldValidationResult

export function toFieldErrors(
  errors: Record<string, string>
): Record<string, string[]>
```

- [ ] **Step 1: Write the tests** (`validate.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import type { CustomFieldDef } from '@/lib/supabase/types'
import { validateCustomFields, toFieldErrors, CF_ERROR_PREFIX } from './validate'

/** Build a minimal active def with sane defaults. */
function def(over: Partial<CustomFieldDef>): CustomFieldDef {
  return {
    id: 'd1',
    entity_type: 'lead',
    key: 'k',
    label: 'K',
    field_type: 'short_text',
    required: false,
    options: [],
    display_order: 0,
    active: true,
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
    ...over,
  }
}

describe('validateCustomFields', () => {
  it('omits optional blank values and reports ok', () => {
    const defs = [def({ key: 'note', label: 'Note', field_type: 'short_text' })]
    const r = validateCustomFields('lead', defs, { note: '   ' })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({})
  })

  it('errors on a required missing value', () => {
    const defs = [def({ key: 'cohort', label: 'Cohort', required: true })]
    const r = validateCustomFields('lead', defs, {})
    expect(r.ok).toBe(false)
    expect(r.errors.cohort).toMatch(/required/i)
  })

  it('trims and stores short_text', () => {
    const defs = [def({ key: 'ref', label: 'Ref' })]
    const r = validateCustomFields('lead', defs, { ref: '  MH-1 ' })
    expect(r).toMatchObject({ ok: true, values: { ref: 'MH-1' } })
  })

  it('coerces number and rejects NaN', () => {
    const defs = [def({ key: 'seats', label: 'Seats', field_type: 'number' })]
    expect(validateCustomFields('lead', defs, { seats: '3' })).toMatchObject({
      ok: true,
      values: { seats: 3 },
    })
    const bad = validateCustomFields('lead', defs, { seats: 'x' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.seats).toMatch(/number/i)
  })

  it('validates dropdown/radio against option values', () => {
    const defs = [
      def({
        key: 'tier',
        label: 'Tier',
        field_type: 'dropdown',
        options: [
          { label: 'Gold', value: 'gold' },
          { label: 'Silver', value: 'silver' },
        ],
      }),
    ]
    expect(validateCustomFields('lead', defs, { tier: 'gold' }).ok).toBe(true)
    const bad = validateCustomFields('lead', defs, { tier: 'bronze' })
    expect(bad.ok).toBe(false)
    expect(bad.errors.tier).toMatch(/valid option/i)
  })

  it('normalises checkbox_group and validates members; empty = unset', () => {
    const defs = [
      def({
        key: 'ch',
        label: 'Channels',
        field_type: 'checkbox_group',
        options: [
          { label: 'Email', value: 'email' },
          { label: 'WhatsApp', value: 'whatsapp' },
        ],
      }),
    ]
    expect(
      validateCustomFields('lead', defs, { ch: 'email' })
    ).toMatchObject({ ok: true, values: { ch: ['email'] } })
    expect(validateCustomFields('lead', defs, { ch: [] })).toMatchObject({
      ok: true,
      values: {},
    })
    const bad = validateCustomFields('lead', defs, { ch: ['email', 'sms'] })
    expect(bad.ok).toBe(false)
  })

  it('validates date format', () => {
    const defs = [def({ key: 'd', label: 'When', field_type: 'date' })]
    expect(
      validateCustomFields('lead', defs, { d: '2026-09-01' })
    ).toMatchObject({ ok: true, values: { d: '2026-09-01' } })
    expect(validateCustomFields('lead', defs, { d: '01/09/2026' }).ok).toBe(
      false
    )
    expect(validateCustomFields('lead', defs, { d: '2026-13-40' }).ok).toBe(
      false
    )
  })

  it('coerces yes_no from booleans and strings', () => {
    const defs = [def({ key: 'y', label: 'Scholarship?', field_type: 'yes_no' })]
    expect(validateCustomFields('lead', defs, { y: 'on' })).toMatchObject({
      ok: true,
      values: { y: true },
    })
    expect(validateCustomFields('lead', defs, { y: false })).toMatchObject({
      ok: true,
      values: { y: false },
    })
  })

  it('requires explicit true for a required yes_no', () => {
    const defs = [
      def({ key: 'y', label: 'Consent', field_type: 'yes_no', required: true }),
    ]
    expect(validateCustomFields('lead', defs, { y: false }).ok).toBe(false)
    expect(validateCustomFields('lead', defs, { y: true }).ok).toBe(true)
  })

  it('drops unknown keys', () => {
    const defs = [def({ key: 'ref', label: 'Ref' })]
    const r = validateCustomFields('lead', defs, { ref: 'a', ghost: 'b' })
    expect(r.values).toEqual({ ref: 'a' })
  })

  it('returns partial values alongside errors', () => {
    const defs = [
      def({ key: 'ref', label: 'Ref' }),
      def({ key: 'n', label: 'N', field_type: 'number' }),
    ]
    const r = validateCustomFields('lead', defs, { ref: 'ok', n: 'x' })
    expect(r.ok).toBe(false)
    expect(r.values).toEqual({ ref: 'ok' })
    expect(r.errors.n).toBeTruthy()
  })
})

describe('toFieldErrors', () => {
  it('prefixes keys and wraps messages in arrays', () => {
    expect(toFieldErrors({ n: 'bad' })).toEqual({
      [`${CF_ERROR_PREFIX}n`]: ['bad'],
    })
  })
})
```

- [ ] **Step 2: Implement `validate.ts`** (green):

```ts
import type {
  CustomFieldDef,
  CustomFieldEntity,
  CustomFieldValues,
} from '@/lib/supabase/types'

/**
 * Validation + coercion for entity custom fields (spec §5). Pure and
 * dependency-free so it can run in server actions and unit tests. The caller
 * passes the ACTIVE defs for an entity; unknown input keys are dropped.
 */

/** Prefix under which custom-field errors ride an action's `fieldErrors`. */
export const CF_ERROR_PREFIX = 'cf:'

const MAX_SHORT = 500
const MAX_LONG = 5000

export type CustomFieldValidationResult =
  | { ok: true; values: CustomFieldValues; errors: Record<string, string> }
  | { ok: false; values: CustomFieldValues; errors: Record<string, string> }

/** '' / null / undefined / [] all count as "not provided". */
function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  return false
}

const TRUE_STRINGS = new Set(['true', 'on', 'yes', '1'])
const FALSE_STRINGS = new Set(['false', 'off', 'no', '0', ''])

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

export function validateCustomFields(
  _entityType: CustomFieldEntity,
  defs: CustomFieldDef[],
  input: Record<string, unknown>
): CustomFieldValidationResult {
  const values: CustomFieldValues = {}
  const errors: Record<string, string> = {}

  for (const def of defs) {
    const raw = input[def.key]
    const empty = isEmpty(raw)

    if (empty) {
      if (def.required) errors[def.key] = `${def.label} is required.`
      continue // optional-blank → omit
    }

    switch (def.field_type) {
      case 'short_text':
      case 'long_text': {
        const s = String(raw).trim()
        const max = def.field_type === 'short_text' ? MAX_SHORT : MAX_LONG
        if (s.length > max) errors[def.key] = `${def.label} is too long.`
        else values[def.key] = s
        break
      }
      case 'number': {
        const n = Number(String(raw).trim())
        if (Number.isNaN(n)) errors[def.key] = `${def.label} must be a number.`
        else values[def.key] = n
        break
      }
      case 'dropdown':
      case 'radio': {
        const s = String(raw)
        const valid = def.options.some((o) => o.value === s)
        if (!valid) errors[def.key] = `Select a valid option for ${def.label}.`
        else values[def.key] = s
        break
      }
      case 'checkbox_group': {
        const arr = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x))
        const allowed = new Set(def.options.map((o) => o.value))
        const bad = arr.some((x) => !allowed.has(x))
        if (bad) errors[def.key] = `Select valid options for ${def.label}.`
        else values[def.key] = arr
        break
      }
      case 'date': {
        const s = String(raw).trim()
        if (!isRealDate(s)) errors[def.key] = `Enter a valid date for ${def.label}.`
        else values[def.key] = s
        break
      }
      case 'yes_no': {
        let b: boolean | null = null
        if (typeof raw === 'boolean') b = raw
        else {
          const s = String(raw).trim().toLowerCase()
          if (TRUE_STRINGS.has(s)) b = true
          else if (FALSE_STRINGS.has(s)) b = false
        }
        if (b === null) errors[def.key] = `${def.label} must be yes or no.`
        else if (def.required && b !== true)
          errors[def.key] = `${def.label} is required.`
        else values[def.key] = b
        break
      }
    }
  }

  const ok = Object.keys(errors).length === 0
  return ok ? { ok: true, values, errors } : { ok: false, values, errors }
}

/** Map { key: msg } → { `cf:${key}`: [msg] } for an action's `fieldErrors`. */
export function toFieldErrors(
  errors: Record<string, string>
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => [`${CF_ERROR_PREFIX}${k}`, [v]])
  )
}
```

- [ ] **Gate:** `npm run lint && npm run type-check && npm run build && npm run test`.
- [ ] **Commit:** `feat(custom-fields): validation + coercion helper with unit tests`

---

## Workstream 3: def config — schema, queries, actions

### Task 3.1: `schema.ts`

**Files:**

- Create: `src/features/crm/custom-fields/schema.ts`

**Interfaces:**

- Exports `CUSTOM_FIELD_ENTITIES`, `CUSTOM_FIELD_TYPES`, `CUSTOM_CHOICE_FIELD_TYPES`, `customFieldDefSchema`, `CustomFieldDefInput`, `CustomFieldDefInputRaw`.

- [ ] **Step 1:** Implement (mirrors `src/features/forms/schema.ts` `fieldSchema`):

```ts
import { z } from 'zod'
import type { CustomFieldType } from '@/lib/supabase/types'

export const CUSTOM_FIELD_ENTITIES = [
  'product',
  'lead',
  'deal',
  'contact',
] as const

export const CUSTOM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'number',
  'dropdown',
  'radio',
  'checkbox_group',
  'date',
  'yes_no',
] as const satisfies readonly CustomFieldType[]

export const CUSTOM_CHOICE_FIELD_TYPES = [
  'dropdown',
  'radio',
  'checkbox_group',
] as const satisfies readonly CustomFieldType[]

const optionSchema = z.object({
  label: z.string().trim().min(1, 'Option label is required'),
  value: z.string().trim().min(1, 'Option value is required'),
})

export const customFieldDefSchema = z
  .object({
    entity_type: z.enum(CUSTOM_FIELD_ENTITIES),
    key: z
      .string()
      .trim()
      .min(1, 'Key is required')
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Key must be snake_case (lowercase, digits, underscores)'
      ),
    label: z.string().trim().min(1, 'Label is required'),
    field_type: z.enum(CUSTOM_FIELD_TYPES),
    required: z.coerce.boolean().default(false),
    options: z.array(optionSchema).default([]),
  })
  .superRefine((def, ctx) => {
    const needsOptions = (CUSTOM_CHOICE_FIELD_TYPES as readonly string[]).includes(
      def.field_type
    )
    if (needsOptions && def.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one option for this field type',
        path: ['options'],
      })
    }
  })

export type CustomFieldDefInput = z.infer<typeof customFieldDefSchema>
export type CustomFieldDefInputRaw = z.input<typeof customFieldDefSchema>
```

- [ ] **Gate:** lint + type-check + build.

### Task 3.2: `queries.ts`

**Files:**

- Create: `src/features/crm/custom-fields/queries.ts`

**Interfaces:**

```ts
listCustomFieldDefs(entityType: CustomFieldEntity): Promise<CustomFieldDef[]>       // all, ordered — for Settings
getActiveCustomFieldDefs(entityType: CustomFieldEntity): Promise<CustomFieldDef[]>  // active only — for forms + detail
```

- [ ] **Step 1:** Implement (service-role client, order by `display_order`):

```ts
import { getServiceClient } from '@/lib/supabase/server'
import type { CustomFieldDef, CustomFieldEntity } from '@/lib/supabase/types'

export async function listCustomFieldDefs(
  entityType: CustomFieldEntity
): Promise<CustomFieldDef[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .select('*')
    .eq('entity_type', entityType)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to list custom fields: ${error.message}`)
  return (data ?? []) as CustomFieldDef[]
}

export async function getActiveCustomFieldDefs(
  entityType: CustomFieldEntity
): Promise<CustomFieldDef[]> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('custom_field_defs')
    .select('*')
    .eq('entity_type', entityType)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`Failed to list custom fields: ${error.message}`)
  return (data ?? []) as CustomFieldDef[]
}
```

- [ ] **Gate:** lint + type-check + build.

### Task 3.3: `actions.ts` (def CRUD)

**Files:**

- Create: `src/features/crm/custom-fields/actions.ts`

**Interfaces:**

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

createCustomFieldDef(input: CustomFieldDefInputRaw): Promise<ActionResult<CustomFieldDef>>
updateCustomFieldDef(id: string, input: CustomFieldDefInputRaw): Promise<ActionResult<CustomFieldDef>>
reorderCustomFieldDefs(entityType: CustomFieldEntity, orderedIds: string[]): Promise<ActionResult<void>>
setCustomFieldDefActive(id: string, active: boolean): Promise<ActionResult<CustomFieldDef>>
deleteCustomFieldDef(id: string): Promise<ActionResult<void>>
```

- [ ] **Step 1:** Implement, mirroring `src/features/crm/stages/actions.ts` + the `23505` handling in `src/features/products/actions.ts`:
  - `'use server'`; `getCurrentUser()` guard returning `UNAUTHENTICATED` on all five.
  - `createCustomFieldDef`: `customFieldDefSchema.safeParse`; append at `display_order = max(entity_type) + 1`, `active = true`; on unique violation (`error.code === '23505'`) return `fieldErrors: { key: ['This key is already in use for this entity.'] }`.
  - `updateCustomFieldDef`: parse; update `label`, `field_type`, `required`, `options`, `updated_at`; never touch `entity_type` or `key`; same `23505` guard.
  - `reorderCustomFieldDefs`: for each id write `display_order = index + 1` scoped by id (sequential, like `reorderStages`).
  - `setCustomFieldDefActive`: update `active`, `updated_at`.
  - `deleteCustomFieldDef`: hard-delete the row (stored values are not scrubbed — documented in spec §8.3).
  - All: `revalidatePath('/admin/settings/custom-fields')`.
- [ ] **Gate:** lint + type-check + build.
- [ ] **Commit:** `feat(custom-fields): def schema, queries, CRUD actions`

---

## Workstream 4: shared components

### Task 4.1: `CustomFieldsCard` (detail, server)

**Files:**

- Create: `src/features/crm/custom-fields/CustomFieldsCard.tsx`

**Interfaces:**

```ts
export function CustomFieldsCard(props: {
  defs: CustomFieldDef[]     // active defs, ordered
  values: CustomFieldValues  // entity.custom_fields
}): React.ReactNode
```

- [ ] **Step 1:** Implement (server component — no `'use client'`):
  - Return `null` when `defs.length === 0`.
  - Render a `<section>` matching the detail `Card` styling (`rounded-[12px] border border-line bg-surface p-5`, heading `text-xs font-semibold uppercase tracking-[0.12em] text-dim` reading "Custom fields") with a `<dl>` of label/value rows (`flex justify-between … border-b border-line py-2.5 last:border-b-0`).
  - Format per type: `yes_no` → `Yes`/`No`; `checkbox_group` → matching option **labels** joined `, `; `dropdown`/`radio` → matching option **label** (fallback raw value); `date` → `Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })`; `number` → `tabular-nums`; missing → `—`.
- [ ] **Gate:** lint + type-check + build.

### Task 4.2: `CustomFieldInputs` (form, client, controlled)

**Files:**

- Create: `src/features/crm/custom-fields/CustomFieldInputs.tsx`

**Interfaces:**

```ts
export default function CustomFieldInputs(props: {
  defs: CustomFieldDef[]                // active defs, ordered
  values: CustomFieldValues             // controlled value map (by key)
  errors?: Record<string, string[]>     // action fieldErrors; reads `${CF_ERROR_PREFIX}${key}`
  onChange: (next: CustomFieldValues) => void
}): React.ReactNode
```

- [ ] **Step 1:** Implement (`'use client'`, controlled — matches `LeadForm`/`ProductForm`):
  - Return `null` when `defs.length === 0`.
  - For each def render a labelled control using the shared `inputClass`/`labelClass` tokens; required defs show a marker.
  - Control per type: `short_text`→text, `long_text`→textarea, `number`→number, `date`→date, `yes_no`→checkbox, `dropdown`→select (with a blank "— Select —" option), `radio`→radio group, `checkbox_group`→checkbox list (toggles membership). Choice controls map `def.options`.
  - On change, call `onChange({ ...values, [key]: nextValue })` (for checkbox_group, add/remove the option value in the array).
  - Field error via the shared `FieldError` pattern, read from `errors?.[`${CF_ERROR_PREFIX}${def.key}`]`.
- [ ] **Gate:** lint + type-check + build.
- [ ] **Commit:** `feat(custom-fields): shared CustomFieldsCard + CustomFieldInputs`

---

## Workstream 5: Settings → Custom Fields admin UI

### Task 5.1: Editor + page + nav

**Files:**

- Create: `src/app/admin/settings/custom-fields/page.tsx`
- Create: `src/app/admin/settings/custom-fields/CustomFieldsEditor.tsx`
- Create: `src/app/admin/settings/custom-fields/CustomFieldDefRow.tsx`
- Modify: `src/app/admin/settings/SettingsNav.tsx`

**Interfaces:**

- `page.tsx` (server, `dynamic = 'force-dynamic'`): loads `listCustomFieldDefs(e)` for each of the four entities and passes a `Record<CustomFieldEntity, CustomFieldDef[]>` to the editor.
- `CustomFieldsEditor` (client): props `{ defsByEntity: Record<CustomFieldEntity, CustomFieldDef[]> }`.
- `CustomFieldDefRow` (client): one def row — collapsed summary + expandable editor with the options editor (models `src/features/forms/FieldRow.tsx`).

- [ ] **Step 1:** `SettingsNav` — add `{ href: '/admin/settings/custom-fields', label: 'Custom Fields' }` to `SETTINGS_NAV`.
- [ ] **Step 2:** `page.tsx` — load all four entities' defs and render `<CustomFieldsEditor defsByEntity={…} />`.
- [ ] **Step 3:** `CustomFieldsEditor` — entity selector pills (`Products`/`Leads`/`Deals`/`Contacts`) styled like `SettingsNav`; below, a row-border table (matching `StagesEditor`) of the selected entity's defs with up/down reorder, active toggle, Edit, Delete, plus an "Add a field" expandable editor. Mutations call the Task 3.3 actions, then `router.refresh()`; surface `ActionResult.error` in a `role="alert"` banner and `fieldErrors` inline. Key is create-only (locked on edit). Include the helper text: "Changing type or options does not convert existing data" and a delete warning that deactivating is the reversible alternative.
- [ ] **Step 4:** `CustomFieldDefRow` — collapsed summary (label, mono key, type, required/inactive chips) + expanded editor (Label, Key [locked on edit], Type, Required, and the options editor for choice types), reusing `FieldRow`'s option add/remove UI.
- [ ] **Gate:** lint + type-check + build.
- [ ] **Commit:** `feat(custom-fields): Settings → Custom Fields admin UI`

---

## Workstream 6: entity wiring (exemplar = Lead; then repeat)

### Task 6.1: Lead — schema + actions accept/persist `custom_fields` (EXEMPLAR)

**Files:**

- Modify: `src/features/crm/leads/schema.ts`
- Modify: `src/features/crm/leads/actions.ts`

**Interfaces:**

- `leadSchema` gains a passthrough for raw custom values; `createLead`/`updateLead` validate + merge `custom_fields`.

- [ ] **Step 1:** In `leads/schema.ts`, accept an untyped custom bag alongside the typed fields (kept separate from the static schema — the helper validates it):

```ts
// add to leadSchema object:
custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
```

- [ ] **Step 2:** In `leads/actions.ts` `createLead`, after the existing `getCurrentUser()` + `leadSchema` parse:

```ts
import { getActiveCustomFieldDefs } from '@/features/crm/custom-fields/queries'
import { validateCustomFields, toFieldErrors } from '@/features/crm/custom-fields/validate'

const defs = await getActiveCustomFieldDefs('lead')
const cf = validateCustomFields('lead', defs, parsed.data.custom_fields ?? {})
if (!cf.ok) {
  return {
    ok: false,
    error: 'Please correct the highlighted fields.',
    fieldErrors: toFieldErrors(cf.errors),
  }
}
// include in the insert payload:
//   .insert({ …existing columns…, custom_fields: cf.values })
```

- [ ] **Step 3:** In `updateLead`, do the same, but **preserve values for inactive/deleted defs**: load the row's existing `custom_fields`, drop the keys present in `defs` (active set), then spread `cf.values` on top:

```ts
const { data: existing } = await supabase
  .from('leads')
  .select('custom_fields')
  .eq('id', id)
  .maybeSingle()
const activeKeys = new Set(defs.map((d) => d.key))
const preserved = Object.fromEntries(
  Object.entries((existing?.custom_fields ?? {}) as Record<string, unknown>).filter(
    ([k]) => !activeKeys.has(k)
  )
)
const mergedCustom = { ...preserved, ...cf.values }
// update payload: { …existing columns…, custom_fields: mergedCustom }
```

- [ ] **Gate:** lint + type-check + build (+ test).

### Task 6.2: Lead — forms + detail render (EXEMPLAR)

**Files:**

- Modify: `src/app/admin/leads/LeadForm.tsx`
- Modify: `src/app/admin/leads/new/page.tsx`
- Modify: `src/app/admin/leads/[id]/edit/page.tsx`
- Modify: `src/app/admin/leads/[id]/page.tsx`

- [ ] **Step 1:** `LeadForm` — add `customFieldDefs: CustomFieldDef[]` to props; hold `const [customFields, setCustomFields] = useState<CustomFieldValues>(props.lead?.custom_fields ?? {})`; render `<CustomFieldInputs defs={customFieldDefs} values={customFields} errors={fieldErrors} onChange={setCustomFields} />` below the native fields; include `custom_fields: customFields` in the action payload.
- [ ] **Step 2:** `new/page.tsx` + `[id]/edit/page.tsx` — `const customFieldDefs = await getActiveCustomFieldDefs('lead')` and pass to `LeadForm`.
- [ ] **Step 3:** `[id]/page.tsx` detail — `const customFieldDefs = await getActiveCustomFieldDefs('lead')`; render `<CustomFieldsCard defs={customFieldDefs} values={detail.lead.custom_fields} />` inside the card grid.
- [ ] **Gate:** lint + type-check + build.
- [ ] **Commit:** `feat(custom-fields): wire Lead create/edit + detail (exemplar)`

### Task 6.3: Repeat for Contact, Deal, Product

Repeat Tasks 6.1–6.2 for each remaining entity — identical shape, swapping the entity name:

- **Contact:** `src/features/crm/contacts/{schema.ts,actions.ts}`, `src/app/admin/contacts/ContactForm.tsx`, `.../new`, `.../[id]/edit`, `.../[id]/page.tsx`; `getActiveCustomFieldDefs('contact')`.
- **Deal:** `src/features/crm/deals/{schema.ts,actions.ts}`, `src/app/admin/deals/DealForm.tsx`, `.../new`, `.../[id]/edit`, `.../[id]/page.tsx`; `getActiveCustomFieldDefs('deal')`.
- **Product:** `src/features/products/{schema.ts,actions.ts}` (note: `createProduct`/`updateProduct` currently have no `getCurrentUser()` guard — keep them as-is for parity with existing code; validation still runs), `src/features/products/ProductForm.tsx`, product new/edit + detail; `getActiveCustomFieldDefs('product')`.

- [ ] **Gate (each entity):** lint + type-check + build (+ test).
- [ ] **Commit (per entity):** `feat(custom-fields): wire <Entity> create/edit + detail`

---

## Self-Review Notes

- **Names/signatures match the spec exactly:** `validateCustomFields(entityType, defs, input) → { ok, values, errors }`, `toFieldErrors`, `CF_ERROR_PREFIX = 'cf:'`, `CustomFieldsCard({ defs, values })`, `CustomFieldInputs({ defs, values, errors, onChange })`, `customFieldDefSchema`, `listCustomFieldDefs`/`getActiveCustomFieldDefs`, and the five CRUD actions. Migration is `0006_custom_fields.sql`.
- **Storage matches locked decision:** JSONB per entity + one `custom_field_defs` table; values keyed by `def.key`; only set keys stored.
- **Field-type vocabulary** is the forms subset (no `email`/`phone`/`statement`); names align with `src/features/forms/schema.ts`.
- **Filtering is out of scope** — no filter UI or index added; noted as future in the spec.
- **RBAC-independent:** only `getCurrentUser()` is asserted; no dependency on `0005`. Config sits under Settings.
- **Build stays green without applying `0006`:** types are hand-authored (Task 1.2); no gate applies migrations.
- **No seed data** → nothing to guard for idempotency; table/column DDL all use `if not exists`.
- **Update preserves inactive/deleted-def values** (Task 6.1 Step 3) so an edit does not silently wipe hidden data; delete of a def leaves orphaned JSONB keys that simply stop rendering (documented; deactivate is the reversible path).
- **Design tokens** reused from `StagesEditor`/`FieldRow`/detail pages; no new colours or fonts.
- **Confirm before "done":** run the full gate (`lint && type-check && build && test`) and confirm the `validate.test.ts` suite passes (superpowers:verification-before-completion).
- **Open choice for the implementer:** whether the Settings editor loads all four entities' defs in one server pass (recommended, simpler) or lazily per tab; the plan assumes the former.
