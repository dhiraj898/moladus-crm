import Link from 'next/link'

/**
 * Settings landing page (spec §6). Introduces the section and links to the
 * available settings areas — Stages today.
 */
export default function SettingsPage() {
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
