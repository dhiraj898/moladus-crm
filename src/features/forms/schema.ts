import { z } from 'zod'
import type { Binding, FieldType, FieldTransform } from '@/lib/supabase/types'

/**
 * Zod schemas for form + field create/update input (spec §4 — Forms,
 * FormFields).
 *
 * These mirror the DDL in supabase/migrations/0001_init.sql. Enums are kept in
 * exported arrays so the admin UI can render pickers from the same source of
 * truth the validator uses.
 *
 * Optional text columns coerce empty strings to `null` so the DB stores NULL
 * rather than an empty string.
 */

/** Trim, then map an empty string to null for nullable text inputs. */
const nullableText = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .default(null)

/** Map '' / undefined to null before validating an optional uuid. */
const nullableUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().uuid('Select a valid product').nullable().default(null)
)

// ---------------------------------------------------------------------------
// Enum sources of truth (shared with the admin UI)
// ---------------------------------------------------------------------------

/** form_fields.field_type — spec §4. */
export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'dropdown',
  'radio',
  'checkbox_group',
  'date',
  'statement',
  'yes_no',
] as const satisfies readonly FieldType[]

/** Field types that must carry an `options` list. */
export const CHOICE_FIELD_TYPES = [
  'dropdown',
  'radio',
  'checkbox_group',
] as const satisfies readonly FieldType[]

/** form_fields.binding — where an answer is routed on ingest. */
export const BINDINGS = [
  'contact.name',
  'contact.email',
  'contact.whatsapp_number',
  'contact.marketing_consent',
  'lead.source',
  'lead.state',
  'store_only',
] as const satisfies readonly Binding[]

/** form_fields.transform — type coercion applied to an answer. */
export const TRANSFORMS = [
  'string',
  'number',
  'boolean',
] as const satisfies readonly FieldTransform[]

/** visible_when.operator. */
export const VISIBLE_WHEN_OPERATORS = ['eq', 'neq', 'in', 'not_in'] as const

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

export const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers and hyphens only'
    ),
  product_id: nullableUuid,
  // `status` is deliberately NOT part of the form input schema. Publish/unpublish
  // transitions flow only through the dedicated publishForm / unpublishForm
  // actions, which enforce the publish invariant. createForm forces 'draft' and
  // updateForm preserves the stored status.
  welcome_message: nullableText,
  submit_label: z.string().trim().min(1).default('Submit'),
  hide_price: z.coerce.boolean().default(false),
})

/** Parsed, validated form input (post-transform). */
export type FormInput = z.infer<typeof formSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type FormInputRaw = z.input<typeof formSchema>

// ---------------------------------------------------------------------------
// Field schema
// ---------------------------------------------------------------------------

const fieldOptionSchema = z.object({
  label: z.string().trim().min(1, 'Option label is required'),
  value: z.string().trim().min(1, 'Option value is required'),
})

/**
 * visible_when rule. For `in` / `not_in`, value is an array of strings; for
 * `eq` / `neq`, a single string. `null` = always visible.
 */
const visibleWhenSchema = z
  .object({
    field_key: z.string().trim().min(1, 'Referenced field is required'),
    operator: z.enum(VISIBLE_WHEN_OPERATORS),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .refine(
    (vw) =>
      vw.operator === 'in' || vw.operator === 'not_in'
        ? Array.isArray(vw.value) && vw.value.length > 0
        : typeof vw.value === 'string' && vw.value.length > 0,
    { message: 'Rule value does not match the operator', path: ['value'] }
  )
  .nullable()
  .default(null)

export const fieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Key is required')
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Key must be snake_case (lowercase, digits, underscores)'
      ),
    label: z.string().trim().min(1, 'Label is required'),
    field_type: z.enum(FIELD_TYPES),
    required: z.coerce.boolean().default(true),
    display_order: z.coerce.number().int().nonnegative().default(0),
    options: z.array(fieldOptionSchema).nullable().default(null),
    placeholder: nullableText,
    binding: z.enum(BINDINGS).nullable().default(null),
    transform: z.enum(TRANSFORMS).nullable().default(null),
    visible_when: visibleWhenSchema,
  })
  .superRefine((field, ctx) => {
    const needsOptions = (CHOICE_FIELD_TYPES as readonly string[]).includes(
      field.field_type
    )
    if (needsOptions && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one option for this field type',
        path: ['options'],
      })
    }
    // statement fields collect no answer, so they cannot be required or bound.
    if (field.field_type === 'statement' && field.required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Statement fields cannot be required',
        path: ['required'],
      })
    }
  })

/** Parsed, validated field input (post-transform). */
export type FieldInput = z.infer<typeof fieldSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type FieldInputRaw = z.input<typeof fieldSchema>
