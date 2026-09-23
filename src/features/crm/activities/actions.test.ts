import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from '@supabase/supabase-js'

/**
 * Unit tests for the activity actions (plan Task 3.1). The service-role client,
 * the auth boundary, and `revalidatePath` are mocked so these run without a
 * live DB or a request context. `addNote` now asserts
 * `requirePermission(module, 'edit')` before writing — that resolver reads the
 * caller's `profiles` → role — so the per-table mock also answers the `profiles`
 * lookup with a full-permission Admin role (deals/leads scope 'all', which keeps
 * the own-scope ownership guard inert). The mocks expose the recorded insert
 * payload so we can assert exactly what `addNote` writes.
 */

const getCurrentUserMock = vi.fn()
const revalidatePathMock = vi.fn()

// profiles: select→eq→maybeSingle (resolve the caller's role for requirePermission).
const profileMaybeSingleMock = vi.fn()
// activities: insert→select→single (set per-test via mockInsertReturning).
let activitiesInsertMock = vi.fn()

// A full-permission Admin role (deals/leads scope 'all').
const ADMIN_ROLE = {
  id: 'role-admin',
  name: 'Admin',
  permissions: {
    products: { view: true, edit: true },
    forms: { view: true, edit: true },
    leads: { view: true, edit: true, scope: 'all' },
    deals: { view: true, edit: true, scope: 'all' },
    contacts: { view: true, edit: true },
    settings: { view: true, edit: true },
    automation: { view: true, edit: true },
  },
  in_assignment_pool: false,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const fromMock = vi.fn((table: string) => {
  if (table === 'profiles') {
    return { select: () => ({ eq: () => ({ maybeSingle: profileMaybeSingleMock }) }) }
  }
  if (table === 'activities') return { insert: activitiesInsertMock }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/auth', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getServiceClient: () => ({ from: fromMock }),
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
  activitiesInsertMock = insert
  return { insert }
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUserMock.mockResolvedValue(USER)
  // Default: the caller resolves to the full-permission Admin role.
  profileMaybeSingleMock.mockResolvedValue({
    data: { role_id: ADMIN_ROLE.id, role: ADMIN_ROLE },
    error: null,
  })
  // Default insert chain; individual tests override via mockInsertReturning.
  activitiesInsertMock = vi.fn()
})

describe('addNote (plan Task 3.1)', () => {
  it('rejects an empty / whitespace-only body without inserting a row', async () => {
    const result = await addNote('deal', 'deal-1', '   ')

    expect(result.ok).toBe(false)
    // The permission check may read `profiles`, but no activity row is written.
    expect(fromMock).not.toHaveBeenCalledWith('activities')
    expect(activitiesInsertMock).not.toHaveBeenCalled()
  })

  it('rejects when there is no authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    const result = await addNote('deal', 'deal-1', 'a real note')

    expect(result.ok).toBe(false)
    // Fails at authentication, before the service client is touched.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects when the caller lacks edit on the entity module', async () => {
    // A role with deals.edit = false is denied.
    profileMaybeSingleMock.mockResolvedValue({
      data: {
        role_id: 'role-viewer',
        role: {
          ...ADMIN_ROLE,
          id: 'role-viewer',
          is_system: false,
          permissions: {
            ...ADMIN_ROLE.permissions,
            deals: { view: true, edit: false, scope: 'all' },
          },
        },
      },
      error: null,
    })

    const result = await addNote('deal', 'deal-1', 'a real note')

    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalledWith('activities')
  })

  it('inserts exactly one note row with the actor id and trimmed body', async () => {
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
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/interest/deal-1')
  })

  it('revalidates the correct detail path per entity type', async () => {
    mockInsertReturning({ id: 'act-2' })

    await addNote('lead', 'lead-9', 'noted')

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/leads/lead-9')
  })
})
