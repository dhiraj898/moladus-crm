import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
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
// stages: select→in (resolve names) and select→eq→maybeSingle (default stage).
const stagesInMock = vi.fn()
const defaultStageMaybeSingleMock = vi.fn()
// deal_stage_events: insert.
const eventInsertMock = vi.fn()
// products: select('*')→eq→maybeSingle (resolve product for GST).
const productMaybeSingleMock = vi.fn()
// deals: insert→select→single (createDeal) + delete chain is unused here.
const dealInsertSingleMock = vi.fn()
// deal_items: insert (snapshot one order line) + delete→eq (replace on edit).
const dealItemsInsertMock = vi.fn()
const dealItemsDeleteEqMock = vi.fn()

// A full-permission Admin role (deals scope 'all'), returned by the profiles
// lookup that `requirePermission` → `getCurrentUserWithRole` now performs. Scope
// 'all' keeps the own-scope ownership guard inert for these tests.
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
// profiles: select→eq→maybeSingle (resolve the caller's role for requirePermission).
const profileMaybeSingleMock = vi.fn()

function dealsTable() {
  return {
    select: () => ({ eq: () => ({ maybeSingle: dealMaybeSingleMock }) }),
    update: dealUpdateMock,
    insert: () => ({ select: () => ({ single: dealInsertSingleMock }) }),
  }
}

const fromMock = vi.fn((table: string) => {
  if (table === 'deals') return dealsTable()
  if (table === 'stages')
    return {
      select: () => ({
        in: stagesInMock,
        eq: () => ({ maybeSingle: defaultStageMaybeSingleMock }),
      }),
    }
  if (table === 'products')
    return { select: () => ({ eq: () => ({ maybeSingle: productMaybeSingleMock }) }) }
  if (table === 'deal_items')
    return {
      insert: dealItemsInsertMock,
      delete: () => ({ eq: dealItemsDeleteEqMock }),
    }
  if (table === 'deal_stage_events') return { insert: eventInsertMock }
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

// `changeDealStage` now emits a `deal.stage_changed` outbound webhook event.
// `emitEvent` is server-only (service-role client) and best-effort; mock it so
// importing the module under test stays free of `server-only`, and expose the
// spy to assert the stage change fires the event with the resolved from/to.
const emitEventMock = vi.fn()
vi.mock('@/features/webhooks/emit', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

// createDeal validates deal custom fields against the active defs. No defs are
// relevant to these tests, so resolve an empty set (validateCustomFields then
// passes trivially).
vi.mock('@/features/crm/custom-fields/queries', () => ({
  getActiveCustomFieldDefs: vi.fn(async () => []),
}))

import { changeDealStage, createDeal, updateDeal } from './actions'

const USER = { id: 'user-1', email: 'admin@moladus.test' } as unknown as User

const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'

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
  // createDeal success defaults.
  productMaybeSingleMock.mockResolvedValue({
    data: {
      id: PRODUCT_ID,
      name: 'Molecule Starter',
      base_price: 1000,
      currency: 'INR',
      taxable: true,
      gst_percentage: 18,
      price_mode: 'exclusive',
      active: true,
      is_bundle: false,
      bundle_components: null,
      custom_fields: {},
    },
    error: null,
  })
  defaultStageMaybeSingleMock.mockResolvedValue({
    data: { id: 'stage-default' },
    error: null,
  })
  dealInsertSingleMock.mockResolvedValue({ data: { id: 'deal-new' }, error: null })
  dealItemsInsertMock.mockResolvedValue({ error: null })
  dealItemsDeleteEqMock.mockResolvedValue({ error: null })
  // Default: the caller resolves to the full-permission Admin role.
  profileMaybeSingleMock.mockResolvedValue({
    data: { role_id: ADMIN_ROLE.id, role: ADMIN_ROLE },
    error: null,
  })
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

    // (e) the deal.stage_changed outbound event is emitted with from/to names.
    expect(emitEventMock).toHaveBeenCalledWith('deal.stage_changed', {
      dealId: 'deal-1',
      from: 'New',
      to: 'Enrolled',
    })

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/interest/deal-1')
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

describe('createDeal (plan Task 8.4 — single-line order)', () => {
  // Make the GST split deterministic: match the place-of-supply to the business
  // home state so the intra-state (CGST+SGST) branch is taken.
  const originalBusinessState = process.env.BUSINESS_STATE
  beforeEach(() => {
    process.env.BUSINESS_STATE = 'Karnataka'
  })
  afterAll(() => {
    process.env.BUSINESS_STATE = originalBusinessState
  })

  it('writes exactly one deal_items row snapshotting the chosen product', async () => {
    getCurrentUserMock.mockResolvedValue(USER)

    const result = await createDeal({
      contact_id: CONTACT_ID,
      product_id: PRODUCT_ID,
      place_of_supply: 'Karnataka',
      create_payment_link: false,
    })

    expect(result.ok).toBe(true)

    // Exactly one order line, snapshotting the product name + base price, linked
    // to the freshly-inserted deal, with the per-line GST mirroring the deal.
    expect(dealItemsInsertMock).toHaveBeenCalledTimes(1)
    const line = dealItemsInsertMock.mock.calls[0][0]
    expect(line).toMatchObject({
      deal_id: 'deal-new',
      product_id: PRODUCT_ID,
      product_name: 'Molecule Starter',
      base_price: 1000,
    })
    // GST snapshot present (18% intra-state → CGST+SGST, no IGST).
    expect(line.taxable_amount).toBe(1000)
    expect(line.cgst).toBeGreaterThan(0)
    expect(line.sgst).toBeGreaterThan(0)
    expect(line.igst).toBe(0)
    expect(line.total_amount).toBeGreaterThan(line.base_price)
  })

  it('fails the create when the order line cannot be written', async () => {
    getCurrentUserMock.mockResolvedValue(USER)
    dealItemsInsertMock.mockResolvedValue({ error: { message: 'insert failed' } })

    const result = await createDeal({
      contact_id: CONTACT_ID,
      product_id: PRODUCT_ID,
      place_of_supply: 'Karnataka',
      create_payment_link: false,
    })

    expect(result.ok).toBe(false)
  })
})

describe('updateDeal — order-line replacement gating (WS8 SHOULD_FIX)', () => {
  beforeEach(() => {
    getCurrentUserMock.mockResolvedValue(USER)
    dealUpdateEqMock.mockResolvedValue({ error: null })
  })

  it('refuses to edit a form-created order (previous product_id null) and writes nothing', async () => {
    // A form-ingested multi-line order has deals.product_id = null and N
    // snapshotted lines. The single-item manual form can't represent it, and
    // recomputing GST from one picked product would overwrite the deal's
    // aggregate money columns while deal_items still holds N lines. updateDeal
    // must bail BEFORE the deals UPDATE and touch no table.
    dealMaybeSingleMock.mockResolvedValue({
      data: { custom_fields: {}, product_id: null },
      error: null,
    })

    const result = await updateDeal('deal-form', {
      contact_id: CONTACT_ID,
      product_id: PRODUCT_ID,
      place_of_supply: 'Karnataka',
    })

    expect(result.ok).toBe(false)
    // No aggregate overwrite, and the snapshotted lines are left intact.
    expect(dealUpdateMock).not.toHaveBeenCalled()
    expect(dealItemsDeleteEqMock).not.toHaveBeenCalled()
    expect(dealItemsInsertMock).not.toHaveBeenCalled()
  })

  it('replaces the single line for a manual deal when the product changes', async () => {
    // A manual single-item deal always has a product_id; changing it replaces the
    // one snapshotted line.
    dealMaybeSingleMock.mockResolvedValue({
      data: { custom_fields: {}, product_id: 'old-product-id' },
      error: null,
    })

    const result = await updateDeal('deal-manual', {
      contact_id: CONTACT_ID,
      product_id: PRODUCT_ID,
      place_of_supply: 'Karnataka',
    })

    expect(result.ok).toBe(true)
    expect(dealItemsDeleteEqMock).toHaveBeenCalledWith('deal_id', 'deal-manual')
    expect(dealItemsInsertMock).toHaveBeenCalledTimes(1)
    expect(dealItemsInsertMock.mock.calls[0][0]).toMatchObject({
      deal_id: 'deal-manual',
      product_id: PRODUCT_ID,
    })
  })

  it('leaves lines untouched for a manual deal when the product is unchanged', async () => {
    dealMaybeSingleMock.mockResolvedValue({
      data: { custom_fields: {}, product_id: PRODUCT_ID },
      error: null,
    })

    const result = await updateDeal('deal-manual', {
      contact_id: CONTACT_ID,
      product_id: PRODUCT_ID,
      place_of_supply: 'Karnataka',
    })

    expect(result.ok).toBe(true)
    expect(dealItemsDeleteEqMock).not.toHaveBeenCalled()
    expect(dealItemsInsertMock).not.toHaveBeenCalled()
  })
})
