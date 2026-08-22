import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from '@supabase/supabase-js'

/**
 * Unit tests for the activity actions (plan Task 3.1). The service-role client,
 * the auth boundary, and `revalidatePath` are mocked so these run without a
 * live DB or a request context. The mocks expose the recorded insert payload so
 * we can assert exactly what `addNote` writes.
 */

const getCurrentUserMock = vi.fn()
const fromMock = vi.fn()
const getUserByIdMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/supabase/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({
    from: fromMock,
    auth: { admin: { getUserById: getUserByIdMock } },
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { addNote } from './actions'

const USER = { id: 'user-1', email: 'admin@moladus.test' } as unknown as User

/** Build the insert→select→single chain a successful insert walks through. */
function mockInsertReturning(row: unknown) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  fromMock.mockReturnValue({ insert })
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addNote (plan Task 3.1)', () => {
  it('rejects an empty / whitespace-only body without touching the DB', async () => {
    getCurrentUserMock.mockResolvedValue(USER)

    const result = await addNote('deal', 'deal-1', '   ')

    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects when there is no authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    const result = await addNote('deal', 'deal-1', 'a real note')

    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('inserts exactly one note row with the actor id and trimmed body', async () => {
    getCurrentUserMock.mockResolvedValue(USER)
    const savedRow = {
      id: 'act-1',
      entity_type: 'deal',
      entity_id: 'deal-1',
      type: 'note',
      actor_id: 'user-1',
      body: 'hello world',
      metadata: {},
      created_at: '2026-08-22T00:00:00.000Z',
    }
    const { insert } = mockInsertReturning(savedRow)

    const result = await addNote('deal', 'deal-1', '  hello world  ')

    expect(fromMock).toHaveBeenCalledWith('activities')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({
      entity_type: 'deal',
      entity_id: 'deal-1',
      type: 'note',
      actor_id: 'user-1',
      body: 'hello world',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe('act-1')
    // Note refreshes the deal detail page.
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/deals/deal-1')
  })

  it('revalidates the correct detail path per entity type', async () => {
    getCurrentUserMock.mockResolvedValue(USER)
    mockInsertReturning({ id: 'act-2' })

    await addNote('lead', 'lead-9', 'noted')

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/leads/lead-9')
  })
})
