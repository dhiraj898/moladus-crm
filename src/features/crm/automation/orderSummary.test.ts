import { describe, it, expect } from 'vitest'
import { formatItemsNote } from './orderSummary'

describe('formatItemsNote', () => {
  it('joins each line as "name ₹total" with semicolons', () => {
    const note = formatItemsNote([
      { product_name: 'Course A', total_amount: 1180 },
      { product_name: 'Course B', total_amount: 545 },
    ])
    expect(note).toBe('Course A ₹1,180.00; Course B ₹545.00')
  })

  it('handles a single line', () => {
    expect(formatItemsNote([{ product_name: 'A+B+C - Elite', total_amount: 9999 }])).toBe(
      'A+B+C - Elite ₹9,999.00'
    )
  })

  it('truncates with an ellipsis past the note length cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      product_name: `Product ${i}`,
      total_amount: 1000,
    }))
    const note = formatItemsNote(many)
    expect(note.length).toBeLessThanOrEqual(250)
    expect(note.endsWith('…')).toBe(true)
  })
})
