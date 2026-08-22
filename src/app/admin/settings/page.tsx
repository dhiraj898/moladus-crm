import Link from 'next/link'
import { requireModuleView } from '@/features/rbac/guard'

/**
 * Settings landing page (spec §6). Introduces the section and links to the
 * available settings areas — Stages today. Re-asserts `settings.view` because
 * the section shell admits automation-only users (see SettingsLayout); an
 * automation-only user hitting this page is redirected to their first allowed
 * module rather than shown settings content.
 */
export default async function SettingsPage() {
  await requireModuleView('settings')
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/settings/stages"
        className="group rounded-[12px] border border-line bg-surface px-5 py-5 transition-colors hover:border-accent"
      >
        <p className="text-sm font-semibold text-text group-hover:text-accent">
          Stages
        </p>
        <p className="mt-1 text-sm text-dim">
          Configure the deal pipeline — add, rename, reorder, and set the
          default stage for new deals.
        </p>
      </Link>
    </div>
  )
}
