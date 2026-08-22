import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the contacts section (spec §7 / plan Task 6.1). Thin server
 * component: `requireModuleView('contacts')` redirects an unauthenticated user
 * to login, and a user lacking `contacts.view` to their first allowed module
 * (or /admin/no-access).
 */
export default async function ContactsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('contacts')
  return <>{children}</>
}
