import 'server-only'
import { getServiceClient } from '@/lib/supabase/server'

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
