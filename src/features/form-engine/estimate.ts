import type { Product } from '@/lib/supabase/types'

/**
 * Display-only price estimate for the public form header (plan Task 6.2 Step 2:
 * "live cost estimate from product base_price / gst").
 *
 * This is a PREVIEW total shown before the customer's state is known, so it does
 * not split GST into CGST/SGST/IGST — that authoritative split happens in the
 * ingest pipeline via the `gst` module (Workstream 7 / spec §7). The GST rate is
 * always read from the product row (never hardcoded) and each line is rounded to
 * 2 decimal places.
 */

/** Round to 2 decimal places (paise precision). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface PriceEstimate {
  /** Pre-tax taxable amount. */
  base: number
  /** GST rate percentage read from the product (0 when non-taxable). */
  gstRate: number
  /** Total GST amount across the line. */
  gstAmount: number
  /** Amount the customer pays. */
  total: number
  /** ISO currency code (defaults to INR). */
  currency: string
}

/**
 * Compute the preview estimate for a product. Mirrors the base/total derivation
 * of spec §7 without the intra/inter-state split.
 */
export function estimatePrice(product: Product): PriceEstimate {
  const currency = product.currency ?? 'INR'

  if (product.taxable === false) {
    return {
      base: round2(product.base_price),
      gstRate: 0,
      gstAmount: 0,
      total: round2(product.base_price),
      currency,
    }
  }

  const gstRate = product.gst_percentage ?? 0
  const rate = gstRate / 100

  let base: number
  let total: number
  if (product.price_mode === 'inclusive') {
    base = round2(product.base_price / (1 + rate))
    total = round2(product.base_price)
  } else {
    base = round2(product.base_price)
    total = round2(base * (1 + rate))
  }

  return {
    base,
    gstRate,
    gstAmount: round2(total - base),
    total,
    currency,
  }
}

/** Format a numeric amount as a currency string (e.g. `₹1,180.00`). */
export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Unknown currency code — fall back to a plain fixed-2 rendering.
    return `${currency} ${amount.toFixed(2)}`
  }
}
