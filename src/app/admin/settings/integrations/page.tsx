import { getEnv } from '@/lib/env'
import { requireModuleView } from '@/features/rbac/guard'
import { getIntegrationStatus } from '@/features/integrations/queries'
import IntegrationsEditor from './IntegrationsEditor'

/**
 * Integrations settings page (Spec A, Task 4.1). Server component: re-asserts
 * `settings.view` (the section shell also admits automation-only users — see
 * SettingsLayout), loads the masked secret status via the server-only
 * `getIntegrationStatus`, and hands it to the client editor.
 *
 * SECURITY: only masked status (isSet + source + updatedAt) crosses to the
 * client — never a secret value. `NEXT_PUBLIC_APP_URL` supplies the inbound
 * webhook URLs, which are non-secret and derived, not stored.
 */
export const dynamic = 'force-dynamic'

export default async function IntegrationsSettingsPage() {
  await requireModuleView('settings')
  const status = await getIntegrationStatus()
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL
  return <IntegrationsEditor status={status} appUrl={appUrl} />
}
