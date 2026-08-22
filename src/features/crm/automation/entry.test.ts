import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EntryRule } from '@/lib/supabase/types'

/**
 * Unit tests for the entry-stage resolver (plan Task 2.2 / design §4.1).
 *
 * `listActiveEntryRules` and the service-role client are mocked so these run
 * without a live DB. The resolver walks active rules by ascending priority and
 * returns the first whose condition matches; when none match it falls back to
 * the `stages.is_default` stage id.
 */

const listActiveEntryRulesMock = vi.fn<() => Promise<EntryRule[]>>()
const defaultStageMaybeSingleMock = vi.fn()

vi.mock('./queries', () => ({
  listActiveEntryRules: () => listActiveEntryRulesMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === 'stages') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: defaultStageMaybeSingleMock }) }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { resolveEntryStage } from './entry'

/** Build an EntryRule with sensible defaults; override per test. */
function rule(partial: Partial<EntryRule>): EntryRule {
  return {
    id: partial.id ?? 'rule',
    condition: partial.condition ?? null,
    to_stage_id: partial.to_stage_id ?? 'stage',
    priority: partial.priority ?? 100,
    active: partial.active ?? true,
    created_at: '2026-08-22T00:00:00Z',
    updated_at: '2026-08-22T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  defaultStageMaybeSingleMock.mockResolvedValue({
    data: { id: 'stage-default' },
    error: null,
  })
})

describe('resolveEntryStage (plan Task 2.2)', () => {
  it('returns the first matching rule by ascending priority', async () => {
    // Rules are already ordered by priority asc (listActiveEntryRules contract).
    listActiveEntryRulesMock.mockResolvedValue([
      rule({ id: 'call', priority: 10, to_stage_id: 'stage-call', condition: { field: 'want_call', op: 'eq', value: 'yes' } }),
      rule({ id: 'default', priority: 1000, to_stage_id: 'stage-payment', condition: null }),
    ])

    const stageId = await resolveEntryStage({ want_call: 'yes' })

    expect(stageId).toBe('stage-call')
    // The default-stage fallback was not consulted.
    expect(defaultStageMaybeSingleMock).not.toHaveBeenCalled()
  })

  it('falls through a non-matching high-priority rule to the NULL-condition catch-all', async () => {
    listActiveEntryRulesMock.mockResolvedValue([
      rule({ id: 'call', priority: 10, to_stage_id: 'stage-call', condition: { field: 'want_call', op: 'eq', value: 'yes' } }),
      rule({ id: 'default', priority: 1000, to_stage_id: 'stage-payment', condition: null }),
    ])

    const stageId = await resolveEntryStage({ want_call: 'no' })

    expect(stageId).toBe('stage-payment')
    expect(defaultStageMaybeSingleMock).not.toHaveBeenCalled()
  })

  it('falls back to the is_default stage when no rule matches', async () => {
    listActiveEntryRulesMock.mockResolvedValue([
      rule({ id: 'call', priority: 10, to_stage_id: 'stage-call', condition: { field: 'want_call', op: 'eq', value: 'yes' } }),
    ])

    const stageId = await resolveEntryStage({ want_call: 'no' })

    expect(stageId).toBe('stage-default')
    expect(defaultStageMaybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the is_default stage when there are no active rules', async () => {
    listActiveEntryRulesMock.mockResolvedValue([])

    const stageId = await resolveEntryStage({})

    expect(stageId).toBe('stage-default')
  })

  it('throws when no rule matches and no default stage is configured', async () => {
    listActiveEntryRulesMock.mockResolvedValue([])
    defaultStageMaybeSingleMock.mockResolvedValue({ data: null, error: null })

    await expect(resolveEntryStage({})).rejects.toThrow(/default stage/i)
  })
})
