import { aggregateGST, computeGST, round2 } from '@/features/gst/compute'
import type { Product } from '@/lib/supabase/types'

export interface OrderItemRow {
  product_id: string
  product_name: string
  base_price: number
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  total_amount: number
}

export interface OrderTotals {
  base_amount: number
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  total_amount: number
}

/** Compute snapshotted line items + aggregated order totals for a cart. */
export function buildOrderItems(
  products: Product[],
  customerState: string
): { items: OrderItemRow[]; totals: OrderTotals } {
  const breakdowns = products.map((p) => computeGST(p, customerState))
  const items: OrderItemRow[] = products.map((p, i) => {
    const g = breakdowns[i]
    return {
      product_id: p.id,
      product_name: p.name,
      base_price: p.base_price,
      taxable_amount: g.taxableAmount,
      cgst: g.cgst,
      sgst: g.sgst,
      igst: g.igst,
      total_amount: g.total,
    }
  })
  const agg = aggregateGST(breakdowns)
  const totals: OrderTotals = {
    base_amount: round2(products.reduce((s, p) => s + p.base_price, 0)),
    taxable_amount: agg.taxableAmount,
    cgst: agg.cgst,
    sgst: agg.sgst,
    igst: agg.igst,
    total_amount: agg.total,
  }
  return { items, totals }
}
