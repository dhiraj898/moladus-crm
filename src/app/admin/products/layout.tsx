import { requireModuleView } from '@/features/rbac/guard'

/**
 * View-gate for the products section (spec §7 / plan Task 6.1). Thin server
 * component: `requireModuleView('products')` redirects an unauthenticated user
 * to login, and a user lacking `products.view` to their first allowed module
 * (or /admin/no-access).
 */
export default async function ProductsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireModuleView('products')
  return <>{children}</>
}
