import type { Product } from '@/lib/supabase/types'

/**
 * GST computation module (spec §7).
 *
 * Pure functions — the only external input beyond the arguments is the business
 * home-state code in `process.env.BUSINESS_STATE`. The GST rate is ALWAYS read
 * from the product row (never hardcoded) and every line amount is rounded to 2
 * decimal places (paise precision).
 *
 * Intra-state supply (customer in the same state the business is registered in)
 * splits tax into CGST + SGST; inter-state supply charges IGST.
 */

/** Round to 2 decimal places (paise precision). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Authoritative GST split for a single product line. */
export interface GSTBreakdown {
  /** Central GST (intra-state only, else 0). */
  cgst: number
  /** State GST (intra-state only, else 0). */
  sgst: number
  /** Integrated GST (inter-state only, else 0). */
  igst: number
  /** Pre-tax taxable amount. */
  taxableAmount: number
  /** Amount the customer pays (taxable amount + tax). */
  total: number
}

/**
 * Compute the authoritative GST breakdown for a product given the customer's
 * state code. Intra-state is decided by `customerState === BUSINESS_STATE`.
 */
export function computeGST(product: Product, customerState: string): GSTBreakdown {
  if (!product.taxable) {
    return {
      cgst: 0,
      sgst: 0,
      igst: 0,
      taxableAmount: product.base_price,
      total: product.base_price,
    }
  }

  const rate = (product.gst_percentage ?? 0) / 100

  let base: number
  if (product.price_mode === 'exclusive') {
    base = product.base_price
  } else {
    // inclusive: extract base from total
    base = round2(product.base_price / (1 + rate))
  }

  const total = product.price_mode === 'exclusive' ? round2(base * (1 + rate)) : product.base_price
  const taxAmount = round2(total - base)

  const intraState = customerState === process.env.BUSINESS_STATE

  return intraState
    ? { cgst: round2(taxAmount / 2), sgst: round2(taxAmount / 2), igst: 0, taxableAmount: base, total }
    : { cgst: 0, sgst: 0, igst: taxAmount, taxableAmount: base, total }
}
