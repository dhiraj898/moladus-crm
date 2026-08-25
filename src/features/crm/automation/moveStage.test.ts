import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for `moveDealStageAsSystem` (plan Task 1.1 / design §5.1).
 *
 * The service-role client, the on-enter action runner, and `logActivity` are all
 * mocked so these run without a live DB. The mock client is configured per-test
 * via the mutable `db` object and the captured call mocks below.
 */

const runStageActionsMock = vi.fn(async (_dealId: string, _stageId: string) => {})
const logActivityMock = vi.fn(async (..._args: unknown[]) => {})

const dealsUpdateEqMock = vi.fn(async () => ({ error: null as unknown }))
const dealStageEventInsertMock = vi.fn(async (_row: unknown) => ({ error: null }))
let dealsUpdatePayload: unknown = null

const db: { stages: unknown[] } = { stages: [] }

/** A thenable query builder returning a fixed result. */
function query(result: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = chain
  b.in = chain
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(res, rej)
  return b
}

// `moveStage.ts` is `import 'server-only'`; neutralise that guard for the unit test.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      switch (table) {
        case 'stages':
          return query(() => ({ data: db.stages, error: null }))
        case 'deals':
          return {
            update: (payload: unknown) => {
              dealsUpdatePayload = payload
              return { eq: dealsUpdateEqMock }
            },
          }
        case 'deal_stage_events':
          return { insert: dealStageEventInsertMock }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
  }),
}))

vi.mock('./runActions', () => ({
  runStageActions: (dealId: string, stageId: string) => runStageActionsMock(dealId, stageId),
}))

vi.mock('@/features/crm/activities/service', () => ({
  logActivity: (...args: unknown[]) => logActivityMock(...args),
}))

import { moveDealStageAsSystem } from './moveStage'

beforeEach(() => {
  vi.clearAllMocks()
  dealsUpdatePayload = null
  db.stages = [
    { id: 'stage-payment', name: 'Payment Link Sent' },
    { id: 'stage-enrolled', name: 'Enrolled' },
  ]
  dealsUpdateEqMock.mockResolvedValue({ error: null })
})

describe('moveDealStageAsSystem (plan Task 1.1)', () => {
  it('updates stage_id + stage_entered_at, writes a NULL-actor event, logs stage_change, runs on-enter actions', async () => {
    await moveDealStageAsSystem('deal-1', 'stage-enrolled', {
      via: 'payment',
      fromStageId: 'stage-payment',
    })

    // Deal row updated with the destination stage + a fresh stage_entered_at.
    expect(dealsUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(dealsUpdatePayload).toMatchObject({ stage_id: 'stage-enrolled' })
    const payload = dealsUpdatePayload as Record<string, unknown>
    expect(typeof payload.stage_entered_at).toBe('string')
    expect(typeof payload.updated_at).toBe('string')

    // Audit trail — system move → actor_id null.
    expect(dealStageEventInsertMock).toHaveBeenCalledTimes(1)
    expect(dealStageEventInsertMock.mock.calls[0][0]).toMatchObject({
      deal_id: 'deal-1',
      stage_id: 'stage-enrolled',
      actor_id: null,
    })

    // stage_change activity with a NULL actor and metadata.via.
    expect(logActivityMock).toHaveBeenCalledTimes(1)
    const [entity, id, type, opts] = logActivityMock.mock.calls[0] as [
      string,
      string,
      string,
      { actorId: unknown; metadata: Record<string, unknown> },
    ]
    expect(entity).toBe('deal')
    expect(id).toBe('deal-1')
    expect(type).toBe('stage_change')
    expect(opts.actorId).toBeNull()
    expect(opts.metadata).toMatchObject({
      from: 'Payment Link Sent',
      to: 'Enrolled',
      via: 'payment',
    })

    // Destination on-enter actions run.
    expect(runStageActionsMock).toHaveBeenCalledWith('deal-1', 'stage-enrolled')
  })

  it('throws when the stage update fails (caller decides fatality)', async () => {
    dealsUpdateEqMock.mockResolvedValueOnce({ error: { message: 'db down' } })

    await expect(moveDealStageAsSystem('deal-1', 'stage-enrolled')).rejects.toThrow(
      /move_stage update failed/
    )

    // Failure is before the event/activity/on-enter steps.
    expect(dealStageEventInsertMock).not.toHaveBeenCalled()
    expect(runStageActionsMock).not.toHaveBeenCalled()
  })

  it('defaults via to null and from to null when opts omitted', async () => {
    await moveDealStageAsSystem('deal-1', 'stage-enrolled')

    const opts = logActivityMock.mock.calls[0][3] as { metadata: Record<string, unknown> }
    expect(opts.metadata).toMatchObject({ from: null, to: 'Enrolled', via: null })
  })
})
