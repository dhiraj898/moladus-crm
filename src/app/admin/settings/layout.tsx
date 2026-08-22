import { requireAnyModuleView } from '@/features/rbac/guard'
import { can } from '@/features/rbac/can'
import SettingsNav from './SettingsNav'

/**
 * Settings section shell (spec §6 — Settings; plan Task 6.1/6.2). Admits any
 * role that can view `settings` OR `automation`, because automation nests under
 * this layout: gating the shell on `settings` alone would trap an
 * automation-only user in an infinite redirect loop (their firstAllowedModule
 * resolves back into this settings-gated subtree). The Stages / Roles / Users
 * pages each re-assert `settings.view`, and the automation sub-layout asserts
 * `automation.view`, so no page is reachable without its own module's view.
 * Renders a section header and a permission-filtered sub-nav.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireAnyModuleView(['settings', 'automation'])
  const allowed = {
    settings: can(ctx.permissions, 'settings', 'view'),
    automation: can(ctx.permissions, 'automation', 'view'),
  }

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-sm text-dim">
          Configure how the CRM behaves across the workspace.
        </p>
      </div>
      <div className="mb-8 border-b border-line pb-4">
        <SettingsNav allowed={allowed} />
      </div>
      {children}
    </div>
  )
}
