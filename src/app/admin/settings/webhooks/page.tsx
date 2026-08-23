import { requireModuleView } from '@/features/rbac/guard'
import {
  listEndpoints,
  getEndpointDeliveries,
  type DeliveryListItem,
} from '@/features/webhooks/queries'
import WebhooksEditor from './WebhooksEditor'

/**
 * Settings → Webhooks page (Spec B, plan WS4 Task 5). Server component:
 * re-asserts `settings.view` (the section shell also admits automation-only
 * users — see SettingsLayout), loads every endpoint plus its recent deliveries
 * via the server-only queries, and hands the plain data to the client editor.
 *
 * SECURITY: only non-secret endpoint columns cross to the client — the encrypted
 * `secret_enc` is never selected, and plaintext secrets are surfaced only once,
 * inline, from the create/rotate action results (never from this initial load).
 */
export const dynamic = 'force-dynamic'

export default async function WebhooksSettingsPage() {
  await requireModuleView('settings')

  const endpoints = await listEndpoints()

  // Load recent deliveries for each endpoint in parallel.
  const deliveriesByEndpoint: Record<string, DeliveryListItem[]> = {}
  await Promise.all(
    endpoints.map(async (ep) => {
      deliveriesByEndpoint[ep.id] = await getEndpointDeliveries(ep.id)
    })
  )

  return (
    <WebhooksEditor
      endpoints={endpoints}
      deliveriesByEndpoint={deliveriesByEndpoint}
    />
  )
}
