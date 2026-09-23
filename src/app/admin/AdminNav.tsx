'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ModuleKey } from '@/lib/supabase/types'

/**
 * Primary sidebar nav (plan Task 6.2). Each item maps to the module whose
 * `view` capability gates it; Settings is shown when the role can view either
 * `settings` or `automation` (automation lives under Settings). The `allowed`
 * map is computed server-side in `AdminLayout` from the resolved permissions.
 */
const NAV_ITEMS: {
  href: string
  label: string
  module: ModuleKey
}[] = [
  { href: '/admin/products', label: 'Products', module: 'products' },
  { href: '/admin/forms', label: 'Forms', module: 'forms' },
  { href: '/admin/leads', label: 'Leads', module: 'leads' },
  { href: '/admin/interest', label: 'Interests', module: 'deals' },
  { href: '/admin/contacts', label: 'Contacts', module: 'contacts' },
  { href: '/admin/settings', label: 'Settings', module: 'settings' },
]

export default function AdminNav({
  allowed,
}: {
  allowed: Record<ModuleKey, boolean>
}) {
  const pathname = usePathname()

  const items = NAV_ITEMS.filter((item) =>
    item.module === 'settings'
      ? allowed.settings || allowed.automation
      : allowed[item.module]
  )

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'rounded-[8px] px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-surface2 text-text'
                : 'text-dim hover:bg-surface hover:text-text',
            ].join(' ')}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
