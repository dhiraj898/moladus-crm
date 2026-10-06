import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'
import { formatMoney } from '@/features/form-engine/estimate'

/** A line for the Razorpay itemized note (name + its GST-inclusive total). */
export interface OrderLine {
  product_name: string
  total_amount: number
}

/** Max length for a single Razorpay `notes` value (the API rejects long ones). */
const NOTE_VALUE_MAX = 250

/**
 * Format order lines as a semicolon-separated "name ₹total" list for the
 * Razorpay `notes.items` field, e.g. `"A ₹1,180.00; B ₹545.00"`. Truncated with
 * an ellipsis if it would exceed the per-note length cap.
 */
export function formatItemsNote(lines: OrderLine[]): string {
  const s = lines
    .map((l) => `${l.product_name} ${formatMoney(Number(l.total_amount))}`)
    .join('; ')
  return s.length > NOTE_VALUE_MAX ? `${s.slice(0, NOTE_VALUE_MAX - 1)}…` : s
}

/** Full detail for the Razorpay payment link (ALL names, no truncation). */
export interface OrderDetail {
  /** Every item name joined, e.g. `"A, B, C"` — shown on the payment page. */
  description: string
  /** Itemized name + line total for `notes.items`. */
  itemsNote: string
}

/**
 * Build the Razorpay payment-link detail for a deal. Unlike {@link
 * loadLineSummary} (which truncates for WhatsApp readability), this sends the
 * FULL item list so the payer sees every product. Legacy single-product deals
 * resolve to that one product. Falls back to the neutral `"Order"`.
 */
export async function loadOrderDetail(
  dealId: string,
  productId: string | null
): Promise<OrderDetail> {
  const supabase = getServiceClient()

  if (productId) {
    const { data: p } = await supabase
      .from('products')
      .select('name')
      .eq('id', productId)
      .maybeSingle()
    const { data: d } = await supabase
      .from('deals')
      .select('total_amount')
      .eq('id', dealId)
      .maybeSingle()
    const name = (p as { name: string } | null)?.name ?? 'Order'
    const total = Number((d as { total_amount: number } | null)?.total_amount ?? 0)
    return { description: name, itemsNote: formatItemsNote([{ product_name: name, total_amount: total }]) }
  }

  const { data } = await supabase
    .from('deal_items')
    .select('product_name, total_amount')
    .eq('deal_id', dealId)
  const lines = (data ?? []) as OrderLine[]
  if (lines.length === 0) return { description: 'Order', itemsNote: 'Order' }

  return {
    description: lines.map((l) => l.product_name).join(', '),
    itemsNote: formatItemsNote(lines),
  }
}

/**
 * Human-readable product summary for a deal's automation messaging (plan WS7).
 *
 * A deal is either single-product (legacy: `product_id` set) or a multi-line
 * order (`product_id` null, one row per `deal_items`). This resolves both to a
 * single display string used as the payment-link description and the
 * `productName` WhatsApp template param:
 *   - `product_id` set → the single product's name (legacy behaviour preserved).
 *   - `product_id` null → the deal's `deal_items.product_name`s joined, e.g.
 *     `"A, B"` for two and `"A, B, +1 more"` for three or more.
 *   - nothing resolvable → the neutral fallback `"Order"`.
 *
 * Shared by `runActions.ts` (on-enter actions) and `sla.ts` (SLA dispatch) so
 * order-level and single-product deals read identically. `server-only`.
 */
export async function loadLineSummary(
  dealId: string,
  productId: string | null
): Promise<string> {
  const supabase = getServiceClient()

  if (productId) {
    const { data } = await supabase
      .from('products')
      .select('name')
      .eq('id', productId)
      .maybeSingle()
    const name = (data as { name: string } | null)?.name ?? null
    return name ?? 'Order'
  }

  const { data } = await supabase
    .from('deal_items')
    .select('product_name')
    .eq('deal_id', dealId)
  const names = ((data ?? []) as { product_name: string }[]).map((r) => r.product_name)
  if (names.length === 0) return 'Order'
  return names.length <= 2
    ? names.join(', ')
    : `${names.slice(0, 2).join(', ')}, +${names.length - 2} more`
}
