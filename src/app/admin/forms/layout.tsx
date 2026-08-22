import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the forms section (spec §7 / plan Task 6.1). Thin server
 * component: `requireModuleView('forms')` redirects an unauthenticated user to
 * login, and a user lacking `forms.view` to their first allowed module (or
 * /admin/no-access).
 */
export default async function FormsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('forms')
  return <>{children}</>
}
