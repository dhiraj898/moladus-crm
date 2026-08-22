import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from '@supabase/supabase-js'

/**
 * Unit tests for `changeDealStage` (plan Task 4.1). The service-role client, the
 * auth boundary, `logActivity`, and `revalidatePath` are mocked so these run
 * without a live DB or a request context. The per-table mock exposes the update
 * and stage-event insert payloads so we can assert exactly what a stage change
 * writes: the deal update, one stage-event row stamped with the actor, and the
 * `stage_change` activity carrying the `{ from, to }` names.
 */

const getCurrentUserMock = vi.fn()
const logActivityMock = vi.fn()
const revalidatePathMock = vi.fn()

// deals: select→eq→maybeSingle (read current stage) and update→eq (write).
const dealMaybeSingleMock = vi.fn()
const dealUpdateEqMock = vi.fn()
const dealUpdateMock = vi.fn<
  (payload: Record<string, unknown>) => { eq: typeof dealUpdateEqMock }
>(() => ({ eq: dealUpdateEqMock }))
// stages: select→in (resolve names).
const stagesInMock = vi.fn()
// deal_stage_events: insert.
const eventInsertMock = vi.fn()

function dealsTable() {
  return {
    select: () => ({ eq: () => ({ maybeSingle: dealMaybeSingleMock }) }),
    update: dealUpdateMock,
  }
}

const fromMock = vi.fn((table: string) => {
  if (table === 'deals') return dealsTable()
  if (table === 'stages') return { select: () => ({ in: stagesInMock }) }
  if (table === 'deal_stage_events') return { insert: eventInsertMock }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({ from: fromMock }),
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}))

// `actions.ts` imports the server-only Razorpay module at load time (used only
// by createDeal). Mock it so importing the module under test does not pull in
// `server-only` / the Razorpay SDK in the test environment.
vi.mock('@/features/razorpay/paymentLink', () => ({
  createPaymentLink: vi.fn(),
}))

// `changeDealStage` now runs the destination stage's on-enter actions. The
// runner is server-only (Razorpay/AiSensy/Supabase); mock it so importing the
// module under test stays free of `server-only`, and expose the spy so we can
// assert the stage change dispatches the on-enter actions.
const runStageActionsMock = vi.fn()
vi.mock('@/features/crm/automation/runActions', () => ({
  runStageActions: (...args: unknown[]) => runStageActionsMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { changeDealStage } from './actions'

const USER = { id: 'user-1', email: 'admin@moladus.test' } as unknown as User

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible success defaults; individual tests override as needed.
  dealMaybeSingleMock.mockResolvedValue({
    data: { stage_id: 'stage-from' },
    error: null,
  })
  stagesInMock.mockResolvedValue({
    data: [
      { id: 'stage-from', name: 'New' },
      { id: 'stage-to', name: 'Enrolled' },
    ],
    error: null,
  })
  dealUpdateEqMock.mockResolvedValue({ error: null })
  eventInsertMock.mockResolvedValue({ error: null })
})

describe('changeDealStage (plan Task 4.1)', () => {
  it('errors and touches no table when there is no authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    const result = await changeDealStage('deal-1', 'stage-to')

    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })

  it('updates the deal stage, appends one stage event, and logs the change', async () => {
    getCurrentUserMock.mockResolvedValue(USER)

    const result = await changeDealStage('deal-1', 'stage-to')

    expect(result.ok).toBe(true)

    // (a) deal updated with the new stage_id + a stage_entered_at timestamp.
    expect(dealUpdateMock).toHaveBeenCalledTimes(1)
    const updatePayload = dealUpdateMock.mock.calls[0][0]
    expect(updatePayload.stage_id).toBe('stage-to')
    expect(typeof updatePayload.stage_entered_at).toBe('string')
    expect(dealUpdateEqMock).toHaveBeenCalledWith('id', 'deal-1')

    // (b) exactly one stage event, stamped with the actor id.
    expect(eventInsertMock).toHaveBeenCalledTimes(1)
    expect(eventInsertMock.mock.calls[0][0]).toMatchObject({
      deal_id: 'deal-1',
      stage_id: 'stage-to',
      actor_id: 'user-1',
    })

    // (c) stage_change activity with the resolved from/to names.
    expect(logActivityMock).toHaveBeenCalledWith('deal', 'deal-1', 'stage_change', {
      actorId: 'user-1',
      metadata: { from: 'New', to: 'Enrolled' },
    })

    // (d) the destination stage's on-enter actions are dispatched.
    expect(runStageActionsMock).toHaveBeenCalledWith('deal-1', 'stage-to')

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/deals/deal-1')
  })

  it('errors when the target stage does not exist', async () => {
    getCurrentUserMock.mockResolvedValue(USER)
    stagesInMock.mockResolvedValue({
      data: [{ id: 'stage-from', name: 'New' }],
      error: null,
    })

    const result = await changeDealStage('deal-1', 'stage-missing')

    expect(result.ok).toBe(false)
    expect(dealUpdateMock).not.toHaveBeenCalled()
    expect(eventInsertMock).not.toHaveBeenCalled()
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })

  it('errors when the deal does not exist', async () => {
    getCurrentUserMock.mockResolvedValue(USER)
    dealMaybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await changeDealStage('deal-x', 'stage-to')

    expect(result.ok).toBe(false)
    expect(dealUpdateMock).not.toHaveBeenCalled()
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })
})
