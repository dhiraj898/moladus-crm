'use client'

import type { ViewMode } from './types'

/**
 * Segmented control for switching between a list's supported views (design
 * §"ViewSwitcher — segmented control"). Renders only the modes the page
 * offers, in config order; the active mode carries the `--accent` fill. State +
 * persistence live in the parent's `useViewMode`; this is a pure presentation
 * control calling `onChange`.
 */

const LABELS: Record<ViewMode, string> = {
  kanban: 'Kanban',
  table: 'Table',
  list: 'List',
}

/** Minimal inline glyph per mode (design tokens only; currentColor fill). */
function ModeIcon({ mode }: { mode: ViewMode }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (mode === 'kanban') {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="3.5" height="12" rx="1" />
        <rect x="6.25" y="2" width="3.5" height="8" rx="1" />
        <rect x="10.5" y="2" width="3.5" height="10" rx="1" />
      </svg>
    )
  }
  if (mode === 'table') {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M2 6.5h12M2 9.5h12M6 3v10" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  )
}

export default function ViewSwitcher({
  modes,
  value,
  onChange,
}: {
  modes: ViewMode[]
  value: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  if (modes.length <= 1) return null

  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-surface p-1"
    >
      {modes.map((mode) => {
        const active = mode === value
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(mode)}
            className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? 'bg-accent text-white'
                : 'text-dim hover:bg-surface2 hover:text-text'
            }`}
          >
            <ModeIcon mode={mode} />
            {LABELS[mode]}
          </button>
        )
      })}
    </div>
  )
}
