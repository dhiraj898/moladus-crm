import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the automation section (spec §7 / plan Task 6.1). Automation
 * nests under Settings, so it is gated by both the parent `settings` layout and
 * this `automation` layout: a user needs `automation.view` to reach these
 * pages. `requireModuleView('automation')` redirects an unauthenticated user to
 * login, and a user lacking the capability to their first allowed module (or
 * /admin/no-access).
 */
export default async function AutomationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('automation')
  return <>{children}</>
}
