# Spec 4 — Custom Fields — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 4 of 6 in the v1.5/v2 roadmap. Builds on merged v1 + Spec 1 (CRM Depth). Independent of Spec 3 (RBAC) — see §11.

---

## 1. Goal

Let an admin define extra, business-specific fields on the four core CRM entities — **Product, Lead, Deal, Contact** — without a code change or migration. A field is defined once in Settings (label, type, whether required, choice options) and then appears both on that entity's **detail page** and inside its **create/edit form**. Values are captured, validated, coerced, and stored per record.

This turns the fixed v1 schema into something each Molecule programme can shape to its own intake (e.g. "Cohort", "Referred by", "Preferred call slot", "Scholarship?").

---

## 2. Scope

**In scope**

- A single **`custom_field_defs`** table describing admin-defined fields, scoped per entity type.
- A **`custom_fields jsonb`** column on each of `products`, `leads`, `deals`, `contacts` holding the values keyed by definition `key`.
- **Field types** drawn from the existing forms vocabulary: `short_text`, `long_text`, `number`, `dropdown`, `radio`, `checkbox_group`, `date`, `yes_no`.
- A **Settings → Custom Fields** admin screen: per-entity list with add / edit / reorder / activate-deactivate / delete, plus an options editor for choice types.
- A **shared validation + coercion helper** that checks a values object against the active defs for an entity.
- A **shared render component** (`CustomFieldsCard`) for the four detail pages.
- A **shared form-inputs component** (`CustomFieldInputs`) for the four create/edit forms.
- Wiring the four entities' create/edit server actions to validate + persist `custom_fields`.

**Out of scope (later / future)**

- **Filtering, searching, or sorting** records by custom fields — explicitly deferred to a future spec (see §10).
- Custom fields on entities other than the four above (e.g. Activities, Forms).
- Per-role visibility of individual custom fields (Spec 3 governs *reaching* Settings, not field-level ACLs).
- Conditional visibility (`visible_when`) of custom fields, computed/formula fields, uniqueness constraints, file-upload fields.
- Rendering custom fields on the **public form runner** — these are internal CRM fields, not public intake fields (that is what Spec 5 Forms already covers).
- Backfilling or migrating values when a def's type or options change (see §8.4).

---

## 3. Locked decisions (from the user)

1. **Storage = JSONB column per entity + one field-DEFINITIONS table.** Each of `products` / `leads` / `deals` / `contacts` gets `custom_fields jsonb not null default '{}'`. A single `custom_field_defs` table describes the admin-defined fields; values live in the entity's `custom_fields` JSONB keyed by `def.key`.
2. **Field types reuse the forms `FieldType` vocabulary** — the subset `short_text`, `long_text`, `number`, `dropdown`, `radio`, `checkbox_group`, `date`, `yes_no` (names match `src/features/forms/schema.ts` / `form_fields.field_type`).
3. **Rendered in v1** on entity **detail pages** *and* the **create/edit forms** for Lead, Contact, Deal, Product.
4. **Filtering by custom fields is OUT of scope for v1** (future).
5. Admin defines fields in **Settings → Custom Fields**, per entity.

---

## 4. Data model changes

New migration: `supabase/migrations/0006_custom_fields.sql`. Applied out-of-band (Supabase SQL editor / `db push`); the build stays green without applying it because the TypeScript types are hand-authored (§5). RLS is deny-all on the new table; all access is via the service-role client in server actions. There is **no seed data** for this feature (nothing to guard).

### 4.1 `custom_field_defs` (new)

```sql
create table if not exists custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('product','lead','deal','contact')),
  key text not null,                 -- snake_case; stable JSONB key inside custom_fields
  label text not null,               -- human label shown in UI
  field_type text not null check (field_type in (
    'short_text','long_text','number','dropdown','radio','checkbox_group','date','yes_no'
  )),
  required boolean not null default false,
  options jsonb not null default '[]',   -- [{label,value}] for choice types; [] otherwise
  display_order integer not null default 0,
  active boolean not null default true,  -- inactive = hidden from forms + detail, values retained
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table custom_field_defs enable row level security;  -- deny-all; service-role only
create unique index if not exists custom_field_defs_entity_key
  on custom_field_defs (entity_type, key);
create index if not exists custom_field_defs_entity_order
  on custom_field_defs (entity_type, display_order);
```

Notes:

- `(entity_type, key)` is unique — a key is unique *within* an entity, so `lead.cohort` and `deal.cohort` can coexist.
- `key` matches the forms key rule: `^[a-z][a-z0-9_]*$` (snake_case). It is the stable JSONB key; **the UI does not allow editing `key` after creation** (renaming it would orphan stored values). `label` is freely editable.
- `active=false` is a soft hide: the field disappears from forms and detail, but stored values in `custom_fields` are untouched and reappear if reactivated.

### 4.2 `custom_fields` JSONB column on the four entities

```sql
alter table products add column if not exists custom_fields jsonb not null default '{}';
alter table leads    add column if not exists custom_fields jsonb not null default '{}';
alter table deals    add column if not exists custom_fields jsonb not null default '{}';
alter table contacts add column if not exists custom_fields jsonb not null default '{}';
```

Value shape inside `custom_fields`, keyed by `def.key`:

| Field type       | Stored JSON value            | Example                     |
| ---------------- | ---------------------------- | --------------------------- |
| `short_text`     | `string`                     | `"MH-2026"`                 |
| `long_text`      | `string`                     | `"Referred at the …"`       |
| `number`         | `number`                     | `3`                         |
| `dropdown`       | `string` (an option `value`) | `"gold"`                    |
| `radio`          | `string` (an option `value`) | `"weekday"`                 |
| `checkbox_group` | `string[]` (option `value`s) | `["email","whatsapp"]`      |
| `date`           | `string` (`YYYY-MM-DD`)      | `"2026-09-01"`              |
| `yes_no`         | `boolean`                    | `true`                      |

Only keys that have a value are stored. Optional fields left blank are **omitted** from the JSONB (not stored as `null`/`""`) so an entity's `custom_fields` stays compact and "unset" is unambiguous.

### 4.3 TypeScript types (hand-authored, `src/lib/supabase/types.ts`)

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
  options: FieldOption[] // reuses the existing { label; value } shape
  display_order: number
  active: boolean
  created_at: string
  updated_at: string
}
```

`Product`, `Lead`, `Deal`, `Contact` interfaces each gain:

```ts
  custom_fields: CustomFieldValues // jsonb not null default '{}'
```

`FieldOption` is reused from the forms types (`{ label: string; value: string }`).

---

## 5. Validation + coercion helper (shared, pure)

Lives at `src/features/crm/custom-fields/validate.ts`. Pure and dependency-free (no Supabase, no React) so it is unit-testable and can run in both server actions and, if desired, the client.

### 5.1 Signature

```ts
export type CustomFieldValidationResult =
  | { ok: true; values: CustomFieldValues; errors: Record<string, string> }
  | { ok: false; values: CustomFieldValues; errors: Record<string, string> }

/**
 * Validate + coerce a raw values object against the ACTIVE defs for an entity.
 * - `entityType` is informational (used only in messages); the authoritative
 *   list is `defs` (caller passes the active defs for that entity).
 * - `input` is the raw, untrusted values keyed by def.key (strings from a form,
 *   arrays for checkbox groups, etc.).
 * Returns coerced `values` (only keys with a real value; unknown keys dropped)
 * and `errors` keyed by def.key. `ok` is true iff `errors` is empty.
 */
export function validateCustomFields(
  entityType: CustomFieldEntity,
  defs: CustomFieldDef[],
  input: Record<string, unknown>
): CustomFieldValidationResult
```

The result always carries `values` (the successfully-coerced subset) so a caller can re-render the form with the cleaned values even on failure. `ok` mirrors `errors` being empty.

### 5.2 Rules, per type

For each **active** def (caller passes only active defs; the helper does not re-filter), read `input[def.key]`:

- **Emptiness:** `undefined`, `null`, `''`, or `[]` counts as "not provided".
  - If the def is `required` and the value is not provided → `errors[key] = '<Label> is required.'`
  - If not provided and optional → the key is simply omitted from `values`.
- **`short_text` / `long_text`:** coerce to `String`, `trim()`. Max length 500 (short) / 5000 (long) → error if exceeded.
- **`number`:** coerce with `Number(String(v).trim())`; `NaN` → `errors[key] = '<Label> must be a number.'`. Store the number.
- **`dropdown` / `radio`:** coerce to string; must equal one of `def.options[].value` → else `errors[key] = 'Select a valid option for <Label>.'`.
- **`checkbox_group`:** accept `string | string[]`; normalise to `string[]`; every member must be a valid option `value` → else error. Empty array = not provided.
- **`date`:** coerce to string; must match `^\d{4}-\d{2}-\d{2}$` and be a real calendar date → else `errors[key] = 'Enter a valid date for <Label>.'`. Store the string.
- **`yes_no`:** coerce truthiness from `boolean` or the strings `'true'`/`'on'`/`'yes'`/`'1'` → `true`; `'false'`/`'off'`/`'no'`/`'0'`/`''` → `false`. Store the boolean. (A `yes_no` marked `required` requires an explicit `true`; document this in the field's help text.)
- **Unknown keys** in `input` that do not correspond to any def are **dropped** (never stored).

This mirrors the forms engine's `transform`/coercion intent but is self-contained for custom fields.

---

## 6. Shared rendering + input components

### 6.1 `CustomFieldsCard` — detail pages (server component)

`src/features/crm/custom-fields/CustomFieldsCard.tsx`

```ts
export function CustomFieldsCard(props: {
  defs: CustomFieldDef[]        // ACTIVE defs for this entity, in display order
  values: CustomFieldValues     // entity.custom_fields
}): React.ReactNode
```

- Renders a `<section>` styled exactly like the existing detail-page `Card` (`rounded-[12px] border border-line bg-surface p-5`, uppercase dim heading "Custom fields") with a `<dl>` of label/value `Row`s matching `src/app/admin/leads/[id]/page.tsx`.
- **Returns `null` when there are no active defs** (so the card never shows an empty shell).
- Value formatting: `yes_no` → `Yes`/`No`; `checkbox_group` → option **labels** joined with `, `; `dropdown`/`radio` → the matching option **label** (fallback to the raw value); `date` → `Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })`; `number` → `tabular-nums`; missing value → `—`.
- Pure/server-only — no client JS.

### 6.2 `CustomFieldInputs` — create/edit forms (client component, controlled)

`src/features/crm/custom-fields/CustomFieldInputs.tsx`

```ts
export default function CustomFieldInputs(props: {
  defs: CustomFieldDef[]                 // ACTIVE defs for this entity, in order
  values: CustomFieldValues              // controlled value map (by key)
  errors?: Record<string, string[]>      // the action's fieldErrors; looks up `${CF_ERROR_PREFIX}${key}`
  onChange: (next: CustomFieldValues) => void
}): React.ReactNode
```

- Controlled, matching the existing controlled forms (`LeadForm`, `ProductForm`): the parent owns a `customFields` state object and passes `values` + `onChange`.
- Renders one labelled control per active def, using the same `inputClass` / `labelClass` tokens as the entity forms:
  - `short_text` → `<input type="text">`; `long_text` → `<textarea>`; `number` → `<input type="number">`; `date` → `<input type="date">`; `yes_no` → checkbox (or Yes/No control); `dropdown` → `<select>`; `radio` → radio group; `checkbox_group` → checkbox list. Choice controls render from `def.options`.
  - Required defs show a required marker on the label.
  - Field-level errors render via the shared `FieldError` pattern, read from `errors[`${CF_ERROR_PREFIX}${def.key}`]`.
- Returns `null` when there are no active defs (no empty fieldset).
- Exported constant `CF_ERROR_PREFIX = 'cf:'` is shared between the actions and this component.

---

## 7. Wiring create/edit actions

Each entity's create/edit server action gains the same three-step insert of custom fields, using the shared helper. Illustrated for **Lead** (exemplar); Contact, Deal, Product are identical in shape.

```ts
// inside createLead / updateLead, after getCurrentUser() + entity Zod parse:
const defs = await getActiveCustomFieldDefs('lead')            // queries.ts
const cf = validateCustomFields('lead', defs, input.custom_fields ?? {})
if (!cf.ok) {
  return {
    ok: false,
    error: 'Please correct the highlighted fields.',
    fieldErrors: toFieldErrors(cf.errors), // { `cf:${key}`: [msg] }
  }
}
// ...then include custom_fields in the insert/update payload:
.insert({ /* …existing columns…, */ custom_fields: cf.values })
```

- `input.custom_fields` is a raw `Record<string, unknown>` added to each entity's input type (accepted from the form; the existing typed columns are unchanged).
- `toFieldErrors(errors)` maps `{ key: msg }` → `{ `${CF_ERROR_PREFIX}${key}`: [msg] }` so custom-field errors ride the existing `ActionResult.fieldErrors` channel without colliding with the entity's own field errors. It lives in `validate.ts` (or a small `custom-fields/errors.ts`).
- The entity's own Zod schema (`leadSchema`, etc.) is unchanged — custom fields are validated separately by the helper, not by the entity schema, because the ruleset is data-driven, not static.
- **Merge semantics:** `custom_fields` is written wholesale from `cf.values` on each save (the form always submits the full active set). Values for **inactive** or **deleted** defs are not in the form and are therefore not resubmitted — but on `update` we do **not** want to silently wipe a value belonging to a currently-inactive def. Decision: on update, merge `cf.values` over the row's existing `custom_fields` for keys **not** present in the active defs, so hidden/inactive values survive an edit. (Load the existing row's `custom_fields`, drop keys that are in the active-def set, then spread `cf.values` on top.) On create there is nothing to preserve.

---

## 8. Settings → Custom Fields admin UI

Route: `src/app/admin/settings/custom-fields/page.tsx` (server) + `CustomFieldsEditor.tsx` (client). Add a **"Custom Fields"** entry to `SettingsNav` (`src/app/admin/settings/SettingsNav.tsx`).

### 8.1 Layout

- The editor has an **entity selector** at the top — four tabs/pills (`Products`, `Leads`, `Deals`, `Contacts`) styled like `SettingsNav` items — that switch which entity's defs are shown.
- Below it, a **row-border table** (matching `StagesEditor`) of that entity's defs in `display_order`, each row showing: order + up/down reorder arrows, `label`, `key` (mono, read-only), type chip, required chip, active toggle, and Edit / Delete actions.
- An **"Add a field"** form / expandable row (matching `FieldRow`'s expanded editor) with: Label, Key (snake_case, **create-only** — locked on edit), Type, Required checkbox, and — for choice types — an **options editor** (add/remove `{label, value}` rows) identical to `FieldRow`'s.
- The `key` input auto-suggests a snake_case key from the label on create but stays user-editable until first save.

### 8.2 Data flow

- The server page loads defs per entity via `listCustomFieldDefs(entityType)` for all four (or one grouped query) and passes them to the editor.
- All mutations run through Task server actions (§8.3); on success the editor calls `router.refresh()` and surfaces `ActionResult` errors inline via a `role="alert"` banner — same pattern as `StagesEditor`.

### 8.3 Server actions (`src/features/crm/custom-fields/actions.ts`)

All assert `getCurrentUser()` first (per-action auth boundary), validate with Zod (`customFieldDefSchema`), use `getServiceClient()`, and `revalidatePath('/admin/settings/custom-fields')`.

```ts
createCustomFieldDef(input: CustomFieldDefInputRaw): Promise<ActionResult<CustomFieldDef>>
updateCustomFieldDef(id: string, input: CustomFieldDefInputRaw): Promise<ActionResult<CustomFieldDef>>
reorderCustomFieldDefs(entityType: CustomFieldEntity, orderedIds: string[]): Promise<ActionResult<void>>
setCustomFieldDefActive(id: string, active: boolean): Promise<ActionResult<CustomFieldDef>>
deleteCustomFieldDef(id: string): Promise<ActionResult<void>>
```

- `createCustomFieldDef`: appends at `display_order = max(entity) + 1`, `active = true`; maps a Postgres unique-violation (`23505`) on `(entity_type, key)` to a friendly `fieldErrors.key` message (mirrors `createProduct`).
- `updateCustomFieldDef`: updates `label`, `field_type`, `required`, `options` (and `display_order`/`active` via their dedicated actions); **does not change `entity_type` or `key`**.
- `reorderCustomFieldDefs`: writes `display_order = index + 1` per id, scoped to the entity (mirrors `reorderStages`).
- `deleteCustomFieldDef`: hard-deletes the def row. Stored values in entities' `custom_fields` are **not** scrubbed (that would require a scan of every entity row); they become orphaned JSONB keys that no longer render (only active defs render). Documented as accepted behaviour; deactivating is the reversible alternative and is the recommended default (the delete control warns the reader). Optionally guard delete behind a confirm in the client.

### 8.4 Editing a def's type/options after values exist

- Changing a def's `field_type` or removing an option **does not** rewrite existing stored values. On the detail page, a stored value that no longer matches the current options renders as its raw value; in the form it is re-validated on next save and a now-invalid value surfaces as a field error the admin must fix. This is called out in the editor's helper text ("Changing type or options does not convert existing data"). Automatic migration is out of scope.

### 8.5 Schema (`src/features/crm/custom-fields/schema.ts`)

Mirrors `src/features/forms/schema.ts`'s `fieldSchema`:

```ts
export const CUSTOM_FIELD_ENTITIES = ['product','lead','deal','contact'] as const
export const CUSTOM_FIELD_TYPES = [
  'short_text','long_text','number','dropdown','radio','checkbox_group','date','yes_no',
] as const satisfies readonly CustomFieldType[]
export const CUSTOM_CHOICE_FIELD_TYPES = ['dropdown','radio','checkbox_group'] as const

export const customFieldDefSchema = z.object({
  entity_type: z.enum(CUSTOM_FIELD_ENTITIES),
  key: z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/, 'Key must be snake_case'),
  label: z.string().trim().min(1, 'Label is required'),
  field_type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.coerce.boolean().default(false),
  options: z.array(z.object({
    label: z.string().trim().min(1, 'Option label is required'),
    value: z.string().trim().min(1, 'Option value is required'),
  })).default([]),
}).superRefine((def, ctx) => {
  const needsOptions = (CUSTOM_CHOICE_FIELD_TYPES as readonly string[]).includes(def.field_type)
  if (needsOptions && def.options.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Add at least one option for this field type', path: ['options'] })
  }
})

export type CustomFieldDefInput = z.infer<typeof customFieldDefSchema>
export type CustomFieldDefInputRaw = z.input<typeof customFieldDefSchema>
```

`display_order` and `active` are managed by dedicated actions, not this input schema (mirrors `stageSchema`).

### 8.6 Queries (`src/features/crm/custom-fields/queries.ts`)

```ts
listCustomFieldDefs(entityType: CustomFieldEntity): Promise<CustomFieldDef[]>       // all (active+inactive), ordered — for Settings
getActiveCustomFieldDefs(entityType: CustomFieldEntity): Promise<CustomFieldDef[]>  // active only, ordered — for forms + detail
```

---

## 9. UI / detail + form integration points

| Entity  | Detail page (render `CustomFieldsCard`)      | New/Edit page (load active defs → form) | Form component                       |
| ------- | -------------------------------------------- | --------------------------------------- | ------------------------------------ |
| Lead    | `src/app/admin/leads/[id]/page.tsx`          | `.../new`, `.../[id]/edit`              | `src/app/admin/leads/LeadForm.tsx`   |
| Contact | `src/app/admin/contacts/[id]/page.tsx`       | `.../new`, `.../[id]/edit`              | `src/app/admin/contacts/ContactForm` |
| Deal    | `src/app/admin/deals/[id]/page.tsx`          | `.../new`, `.../[id]/edit`              | `src/app/admin/deals/DealForm.tsx`   |
| Product | `src/app/admin/products/[id]` detail (or list-linked) | product new/edit                | `src/features/products/ProductForm`  |

- Detail pages: load `getActiveCustomFieldDefs(entity)` and pass `{ defs, values: record.custom_fields }` to `CustomFieldsCard`, dropped into the existing card grid.
- New/edit pages: load `getActiveCustomFieldDefs(entity)` and pass to the form; the form renders `<CustomFieldInputs>` below its native fields and includes `custom_fields` in the action payload.

---

## 10. Future work (explicitly deferred)

- **Filter / search / sort by custom field** (a GIN index on `custom_fields` + query-builder UI). Called out as the primary follow-up.
- Conditional visibility of custom fields; computed/formula fields; uniqueness; file uploads.
- Field-level role visibility (depends on Spec 3 RBAC).
- Bulk data migration when a def's type/options change.
- Zoho mapping of custom fields (deferred with the wider Zoho integration).

---

## 11. Relationship to Spec 3 (RBAC)

Custom-fields config lives under **Settings**, which any settings-permitted user reaches. This spec **does not hard-depend on Spec 3**: whether or not `0005` (RBAC) is applied, the custom-fields actions enforce the existing `getCurrentUser()` boundary exactly like every other mutating action. If RBAC is present, reaching `/admin/settings/*` is already gated by it; if not, the current admin-session check stands. No RBAC-specific code is added here.

---

## 12. Testing

- **Unit (`validate.test.ts`, Vitest):** the pure `validateCustomFields` helper — the highest-value target (data-driven coercion). Cover: required-missing (each still-provided others pass), optional-omitted (key absent from `values`), `number` coercion + NaN, `date` format valid/invalid, `dropdown`/`radio` valid + invalid option, `checkbox_group` normalisation + invalid member + empty=unset, `yes_no` truthy/falsy string + boolean coercion, unknown keys dropped, and mixed valid+invalid producing partial `values` with the right `errors`.
- **Build-level:** `npm run lint && npm run type-check && npm run build` stay green without applying `0006` (types hand-authored).
- Server actions and React components are covered by existing conventions; no new action tests are mandated (the validation helper carries the logic), matching how `stages`/`leads` actions are shipped.

---

## 13. ENV-PENDING items

- **Applying `0006_custom_fields.sql`** to the live Supabase project (SQL editor / `db push`) is a deployment step, not a build step — the app builds and type-checks against hand-authored types beforehand.
- No new environment variables are introduced by this spec.
- Once the live project is connected, regenerate `src/lib/supabase/types.ts` (`supabase gen types typescript --linked`) to replace the hand-authored `custom_field_defs` + `custom_fields` types.
