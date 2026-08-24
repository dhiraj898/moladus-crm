import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from '@supabase/supabase-js'

/**
 * Unit tests for `changeLeadStatus` (plan Task 2.2). The service-role client,
 * the auth boundary, `logActivity`, and `revalidatePath` are mocked so these run
 * without a live DB or a request context. They assert the own-scope IDOR guard
 * (a lead owned by someone else is rejected as "Not found" and never mutated),
 * the happy-path update + `edited` activity carrying the new status, and that an
 * invalid status is refused before any write.
 */

const getCurrentUserMock = vi.fn()
const logActivityMock = vi.fn()
const revalidatePathMock = vi.fn()

// leads: select→eq→maybeSingle (own-scope owner read) and update→eq (write).
const leadOwnerMaybeSingleMock = vi.fn()
const leadUpdateEqMock = vi.fn()
const leadUpdateMock = vi.fn<
  (payload: Record<string, unknown>) => { eq: typeof leadUpdateEqMock }
>(() => ({ eq: leadUpdateEqMock }))

// profiles: select→eq→maybeSingle (resolve the caller's role for requirePermission).
const profileMaybeSingleMock = vi.fn()

function permissions(scope: 'own' | 'all') {
  return {
    products: { view: true, edit: true },
    forms: { view: true, edit: true },
    leads: { view: true, edit: true, scope },
    deals: { view: true, edit: true, scope: 'all' },
    contacts: { view: true, edit: true },
    settings: { view: true, edit: true },
    automation: { view: true, edit: true },
  }
}

function role(scope: 'own' | 'all') {
  return {
    id: `role-${scope}`,
    name: scope === 'all' ? 'Admin' : 'Rep',
    permissions: permissions(scope),
    in_assignment_pool: false,
    is_system: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function leadsTable() {
  return {
    select: () => ({ eq: () => ({ maybeSingle: leadOwnerMaybeSingleMock }) }),
    update: leadUpdateMock,
  }
}

const fromMock = vi.fn((table: string) => {
  if (table === 'leads') return leadsTable()
  if (table === 'profiles')
    return { select: () => ({ eq: () => ({ maybeSingle: profileMaybeSingleMock }) }) }
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

// `actions.ts` pulls in the custom-fields query module (server-only) at load
// time via createLead/updateLead. Mock it so importing the module under test
// does not require a live request context.
vi.mock('@/features/crm/custom-fields/queries', () => ({
  getActiveCustomFieldDefs: vi.fn().mockResolvedValue([]),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

import { changeLeadStatus } from './actions'

const USER = { id: 'user-1', email: 'rep@moladus.test' } as unknown as User

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentUserMock.mockResolvedValue(USER)
  leadUpdateEqMock.mockResolvedValue({ error: null })
  leadOwnerMaybeSingleMock.mockResolvedValue({
    data: { owner_id: 'user-1' },
    error: null,
  })
  // Default: full-permission Admin (leads scope 'all').
  profileMaybeSingleMock.mockResolvedValue({
    data: { role_id: role('all').id, role: role('all') },
    error: null,
  })
})

describe('changeLeadStatus (plan Task 2.2)', () => {
  it('errors and touches no table when there is no authenticated user', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    const result = await changeLeadStatus('lead-1', 'Contacted')

    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('updates the status and logs an edited activity carrying it', async () => {
    const result = await changeLeadStatus('lead-1', 'Contacted')

    expect(result.ok).toBe(true)

    expect(leadUpdateMock).toHaveBeenCalledTimes(1)
    expect(leadUpdateMock.mock.calls[0][0]).toEqual({ status: 'Contacted' })
    expect(leadUpdateEqMock).toHaveBeenCalledWith('id', 'lead-1')

    expect(logActivityMock).toHaveBeenCalledWith('lead', 'lead-1', 'edited', {
      actorId: 'user-1',
      metadata: { status: 'Contacted' },
    })

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/leads')
  })

  it('rejects an invalid status before any write', async () => {
    const result = await changeLeadStatus(
      'lead-1',
      'Nonsense' as unknown as 'Contacted'
    )

    expect(result.ok).toBe(false)
    expect(leadUpdateMock).not.toHaveBeenCalled()
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  it('own-scope: rejects a lead owned by someone else without mutating', async () => {
    profileMaybeSingleMock.mockResolvedValue({
      data: { role_id: role('own').id, role: role('own') },
      error: null,
    })
    leadOwnerMaybeSingleMock.mockResolvedValue({
      data: { owner_id: 'someone-else' },
      error: null,
    })

    const result = await changeLeadStatus('lead-2', 'Contacted')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Not found')
    expect(leadUpdateMock).not.toHaveBeenCalled()
    expect(logActivityMock).not.toHaveBeenCalled()
  })

  it('own-scope: allows a lead the caller owns', async () => {
    profileMaybeSingleMock.mockResolvedValue({
      data: { role_id: role('own').id, role: role('own') },
      error: null,
    })
    leadOwnerMaybeSingleMock.mockResolvedValue({
      data: { owner_id: 'user-1' },
      error: null,
    })

    const result = await changeLeadStatus('lead-1', 'Pre-Qualified')

    expect(result.ok).toBe(true)
    expect(leadUpdateMock).toHaveBeenCalledTimes(1)
    expect(leadUpdateMock.mock.calls[0][0]).toEqual({ status: 'Pre-Qualified' })
  })
})
