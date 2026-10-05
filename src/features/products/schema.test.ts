import { describe, it, expect } from 'vitest'
import { productSchema } from './schema'

describe('productSchema bundle fields', () => {
  it('parses bundle fields with defaults', () => {
    const r = productSchema.parse({ name: 'A+B - Pro', base_price: 999 })
    expect(r.is_bundle).toBe(false)
    expect(r.bundle_components).toBeNull()
  })
  it('accepts component ids when is_bundle', () => {
    const ids = ['11111111-1111-1111-1111-111111111111']
    const r = productSchema.parse({
      name: 'A+B - Pro',
      base_price: 999,
      is_bundle: true,
      bundle_components: ids,
    })
    expect(r.is_bundle).toBe(true)
    expect(r.bundle_components).toEqual(ids)
  })
})
