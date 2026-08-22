import { redirect } from 'next/navigation'

// Bare /admin has no content of its own; send it to the default section.
// Kept in sync with DEFAULT_AUTHED_PATH in src/middleware.ts.
export default function AdminIndexPage() {
  redirect('/admin/products')
}
