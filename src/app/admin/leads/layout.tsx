import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the leads section (spec §7 / plan Task 6.1). Thin server
 * component: `requireModuleView('leads')` redirects an unauthenticated user to
 * login, and a user lacking `leads.view` to their first allowed module (or
 * /admin/no-access). Record scope (own vs all) is applied in the queries, not
 * here — the layout only enforces `view`.
 */
export default async function LeadsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('leads')
  return <>{children}</>
}
