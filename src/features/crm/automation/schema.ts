import { z } from 'zod'

/**
 * Zod schemas for workflow-automation config input (design §4 / §7).
 *
 * These validate the payloads accepted by the auth-gated CRUD server actions
 * (`actions.ts`) before they touch the service-role client. They mirror the
 * hand-authored row types in `src/lib/supabase/types.ts` but describe *input*
 * (server-managed columns like `id`/`created_at`/`priority`/`run_order` are set
 * by the actions, not the caller).
 */

/** Comparison operators — kept in lockstep with `ConditionOp` in types.ts. */
export const conditionOpSchema = z.enum([
  'eq',
  'neq',
  'in',
  'not_in',
  'is_empty',
  'not_empty',
])

/**
 * A single `{field, op, value}` predicate. `value` is optional (unused for
 * `is_empty`/`not_empty`, an array for `in`/`not_in`, a scalar otherwise) so it
 * is accepted as unknown and interpreted by the evaluator.
 */
export const conditionSchema = z.object({
  field: z.string().trim().min(1, 'Field is required').max(120),
  op: conditionOpSchema,
  value: z.unknown().optional(),
})

/**
 * Entry rule: a `condition` (nullable — NULL is the always-matches fallback)
 * routing a new submission to `to_stage_id`. `priority` orders evaluation
 * (lower first); the actions manage it, but it is accepted here for updates.
 */
export const entryRuleSchema = z.object({
  condition: conditionSchema.nullable(),
  to_stage_id: z.string().uuid('Pick a target stage.'),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
})

/**
 * Stage on-enter action. `action_type` deliberately EXCLUDES `move_stage`
 * (loop guard — only SLA rules move stages). `config` carries the per-type
 * options: `{template}` for `send_whatsapp`, `{}` for `create_payment_link`.
 */
export const stageActionSchema = z
  .object({
    stage_id: z.string().uuid('Pick a stage.'),
    action_type: z.enum(['send_whatsapp', 'create_payment_link']),
    config: z.record(z.string(), z.unknown()).default({}),
    run_order: z.number().int().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action_type === 'send_whatsapp') {
      const template = val.config?.template
      if (typeof template !== 'string' || template.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'template'],
          message: 'A WhatsApp template name is required.',
        })
      }
    }
  })

/**
 * SLA rule: after `delay_minutes` in `from_stage_id`, if `condition` holds,
 * fire `action_type`. `send_whatsapp` needs `config.template`; `move_stage`
 * needs `config.to_stage_id` (a real stage — checked against the DB in the
 * action, shape-checked here).
 */
export const slaRuleSchema = z
  .object({
    from_stage_id: z.string().uuid('Pick a source stage.'),
    delay_minutes: z
      .number()
      .int('Delay must be a whole number of minutes.')
      .positive('Delay must be greater than zero.'),
    condition: conditionSchema.nullable(),
    action_type: z.enum(['send_whatsapp', 'move_stage']),
    config: z.record(z.string(), z.unknown()).default({}),
    active: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action_type === 'send_whatsapp') {
      const template = val.config?.template
      if (typeof template !== 'string' || template.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'template'],
          message: 'A WhatsApp template name is required.',
        })
      }
    }
    if (val.action_type === 'move_stage') {
      const toStageId = val.config?.to_stage_id
      if (
        typeof toStageId !== 'string' ||
        !z.string().uuid().safeParse(toStageId).success
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['config', 'to_stage_id'],
          message: 'Pick a stage to move the deal to.',
        })
      }
    }
  })

/** Raw, pre-parse input shapes accepted by the schemas (what callers pass). */
export type EntryRuleInputRaw = z.input<typeof entryRuleSchema>
export type StageActionInputRaw = z.input<typeof stageActionSchema>
export type SlaRuleInputRaw = z.input<typeof slaRuleSchema>
