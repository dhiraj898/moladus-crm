import { z } from 'zod'

/**
 * Zod schema for stage create/update input (spec §4.1 / §5 — Stages).
 *
 * A stage is a manual sales-pipeline step configured in Settings. `name` is a
 * short human label; `type` classifies the stage for reporting (open / won /
 * lost) and defaults to `open`. `display_order` and `is_default` are managed by
 * dedicated actions (reorder / set-default), not this input schema.
 */
export const stageSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  type: z.enum(['open', 'won', 'lost']).default('open'),
})

/** Parsed, validated stage input (post-transform). */
export type StageInput = z.infer<typeof stageSchema>
/** Raw, pre-parse shape accepted by the schema (what callers pass in). */
export type StageInputRaw = z.input<typeof stageSchema>
