'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Sub-navigation for the Settings section. Active-item highlighting mirrors the
 * primary `AdminNav`. Later specs add more entries (custom fields, roles, etc.).
 */
const SETTINGS_NAV = [
  { href: '/admin/settings/stages', label: 'Stages' },
  { href: '/admin/settings/automation', label: 'Automation' },
] as const

export default function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-1">
      {SETTINGS_NAV.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'rounded-[8px] px-3 py-1.5 text-sm font-medium transition-colors',
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
