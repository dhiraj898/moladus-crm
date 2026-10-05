import { describe, it, expect, beforeAll } from 'vitest'
import { buildOrderItems } from './orderItems'
import type { Product } from '@/lib/supabase/types'

function product(over: Partial<Product>): Product {
  return {
    id: 'p',
    name: 'A',
    code: null,
    sac_code: null,
    description: null,
    base_price: 1000,
    currency: 'INR',
    taxable: true,
    gst_percentage: 18,
    price_mode: 'exclusive',
    active: true,
    is_bundle: false,
    bundle_components: null,
    custom_fields: {},
    created_at: null,
    updated_at: null,
    ...over,
  }
}

describe('buildOrderItems', () => {
  beforeAll(() => {
    process.env.BUSINESS_STATE = 'Karnataka'
  })

  it('snapshots each line and aggregates totals (intra-state)', () => {
    const { items, totals } = buildOrderItems(
      [
        product({ id: 'a', name: 'A', base_price: 1000 }),
        product({ id: 'b', name: 'B', base_price: 500 }),
      ],
      'Karnataka'
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      product_id: 'a',
      product_name: 'A',
      base_price: 1000,
      cgst: 90,
      sgst: 90,
      total_amount: 1180,
    })
    expect(totals).toEqual({
      base_amount: 1500,
      taxable_amount: 1500,
      cgst: 135,
      sgst: 135,
      igst: 0,
      total_amount: 1770,
    })
  })

  it('mixes a non-taxable line and an inter-state line', () => {
    const { totals } = buildOrderItems(
      [
        product({ id: 'a', base_price: 1000 }),
        product({ id: 'c', base_price: 299, taxable: false }),
      ],
      'Maharashtra' // inter-state => igst
    )
    expect(totals).toMatchObject({ igst: 180, cgst: 0, sgst: 0, total_amount: 1479 })
  })
})
