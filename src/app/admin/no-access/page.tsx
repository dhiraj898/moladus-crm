/**
 * No-access landing (spec §7 / plan Task 6.1). Where `requireModuleView`
 * redirects a signed-in user whose role grants no module `view` at all. A plain
 * centered card using design tokens — no nav, no actions, just guidance to
 * contact an administrator.
 */
export default function NoAccessPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-[420px] rounded-[12px] border border-line bg-surface px-8 py-10 text-center">
        <h1 className="text-lg font-bold tracking-[-0.01em] text-text">
          No access to this section
        </h1>
        <p className="mt-2 text-sm text-dim">
          Your role doesn&apos;t grant access here. If you think this is a
          mistake, refresh or contact your administrator.
        </p>
      </div>
    </div>
  )
}
