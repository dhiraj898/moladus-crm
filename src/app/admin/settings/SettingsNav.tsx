'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Settings sub-nav (plan Task 6.2). Stages / Roles / Users require
 * `settings.view`; Automation requires `automation.view`. The `allowed` map is
 * computed server-side in `SettingsLayout` from the resolved permissions and
 * active-item highlighting mirrors the primary `AdminNav`.
 */
const SETTINGS_NAV: {
  href: string
  label: string
  need: 'settings' | 'automation'
}[] = [
  { href: '/admin/settings/stages', label: 'Stages', need: 'settings' },
  {
    href: '/admin/settings/custom-fields',
    label: 'Custom Fields',
    need: 'settings',
  },
  { href: '/admin/settings/roles', label: 'Roles', need: 'settings' },
  { href: '/admin/settings/users', label: 'Users', need: 'settings' },
  { href: '/admin/settings/automation', label: 'Automation', need: 'automation' },
]

export default function SettingsNav({
  allowed,
}: {
  allowed: { settings: boolean; automation: boolean }
}) {
  const pathname = usePathname()

  const items = SETTINGS_NAV.filter((item) => allowed[item.need])

  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((item) => {
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
