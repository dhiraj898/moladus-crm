'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/forms', label: 'Forms' },
  { href: '/admin/leads', label: 'Leads' },
  { href: '/admin/deals', label: 'Deals' },
  { href: '/admin/contacts', label: 'Contacts' },
] as const

/** Sidebar navigation with active-section highlighting. */
export default function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
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
