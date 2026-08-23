import { z } from 'zod'
import type { CustomFieldType } from '@/lib/supabase/types'

/**
 * Zod schema for custom-field definition create/update input (spec §5).
 *
 * Mirrors `src/features/forms/schema.ts` `fieldSchema`: enums live in exported
 * arrays so the Settings admin UI renders pickers from the same source of truth
 * the validator uses. The field-type vocabulary is the forms subset (no
 * `email`/`phone`/`statement`).
 *
 * `entity_type` and `key` are only meaningful on create — an update action must
 * ignore any changes to them (see actions.ts).
 */

/** custom_field_defs.entity_type — the four CRM entities that support custom fields. */
export const CUSTOM_FIELD_ENTITIES = [
  'product',
  'lead',
  'deal',
  'contact',
] as const

/** custom_field_defs.field_type — subset of FieldType reused for custom fields. */
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

/** Field types that must carry an `options` list. */
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
    const needsOptions = (
      CUSTOM_CHOICE_FIELD_TYPES as readonly string[]
    ).includes(def.field_type)
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
