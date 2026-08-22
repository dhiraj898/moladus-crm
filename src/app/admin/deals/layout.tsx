import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the deals section (spec §7 / plan Task 6.1). Thin server
 * component: `requireModuleView('deals')` redirects an unauthenticated user to
 * login, and a user lacking `deals.view` to their first allowed module (or
 * /admin/no-access). Record scope (own vs all) is applied in the queries, not
 * here — the layout only enforces `view`.
 */
export default async function DealsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('deals')
  return <>{children}</>
}
