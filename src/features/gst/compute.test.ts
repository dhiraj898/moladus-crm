import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Product } from '@/lib/supabase/types'
import { computeGST, round2 } from './compute'

const BUSINESS_STATE = 'MH'

/** Build a Product with sensible defaults, overridable per test. */
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_1',
    name: 'Test Product',
    code: null,
    sac_code: null,
    description: null,
    base_price: 1000,
    currency: 'INR',
    taxable: true,
    gst_percentage: 18,
    price_mode: 'exclusive',
    active: true,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe('computeGST (spec §7)', () => {
  const originalBusinessState = process.env.BUSINESS_STATE

  beforeAll(() => {
    process.env.BUSINESS_STATE = BUSINESS_STATE
  })

  afterAll(() => {
    process.env.BUSINESS_STATE = originalBusinessState
  })

  it('non-taxable → all tax 0, total = base', () => {
    const product = makeProduct({ taxable: false, base_price: 1000 })
    const result = computeGST(product, BUSINESS_STATE)
    expect(result).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 0,
      taxableAmount: 1000,
      total: 1000,
    })
  })

  it('exclusive intra-state 1000 @18% → base 1000, cgst 90, sgst 90, igst 0, total 1180', () => {
    const product = makeProduct({ base_price: 1000, gst_percentage: 18, price_mode: 'exclusive' })
    const result = computeGST(product, BUSINESS_STATE)
    expect(result).toEqual({
      cgst: 90,
      sgst: 90,
      igst: 0,
      taxableAmount: 1000,
      total: 1180,
    })
  })

  it('exclusive inter-state 1000 @18% → igst 180, cgst/sgst 0, total 1180', () => {
    const product = makeProduct({ base_price: 1000, gst_percentage: 18, price_mode: 'exclusive' })
    const result = computeGST(product, 'KA')
    expect(result).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 180,
      taxableAmount: 1000,
      total: 1180,
    })
  })

  it('inclusive intra-state 1180 @18% → base 1000, cgst 90, sgst 90, total 1180', () => {
    const product = makeProduct({ base_price: 1180, gst_percentage: 18, price_mode: 'inclusive' })
    const result = computeGST(product, BUSINESS_STATE)
    expect(result).toEqual({
      cgst: 90,
      sgst: 90,
      igst: 0,
      taxableAmount: 1000,
      total: 1180,
    })
  })

  it('rounding: base 999.99 @18% exclusive → tax rounds to 2dp', () => {
    const product = makeProduct({ base_price: 999.99, gst_percentage: 18, price_mode: 'exclusive' })
    const result = computeGST(product, BUSINESS_STATE)
    // 999.99 * 1.18 = 1179.9882 → round2 → 1179.99; tax = 180.00 → split 90/90
    expect(result.taxableAmount).toBe(999.99)
    expect(result.total).toBe(1179.99)
    expect(result.cgst).toBe(90)
    expect(result.sgst).toBe(90)
    expect(result.igst).toBe(0)
    // every returned amount is at most 2 decimal places
    for (const amount of Object.values(result)) {
      expect(round2(amount)).toBe(amount)
    }
  })
})
