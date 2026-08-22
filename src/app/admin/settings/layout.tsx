import SettingsNav from './SettingsNav'

/**
 * Settings section shell (spec §6 — Settings). Renders a section header and a
 * sub-nav above the active settings page. Currently hosts the Stages editor;
 * later specs add more entries to `SettingsNav`.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-sm text-dim">
          Configure how the CRM behaves across the workspace.
        </p>
      </div>
      <div className="mb-8 border-b border-line pb-4">
        <SettingsNav />
      </div>
      {children}
    </div>
  )
}
