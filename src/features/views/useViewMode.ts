'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ViewMode } from './types'

/**
 * View-mode resolution + persistence for the list-view framework (design
 * §"View persistence: `?view=` URL param + `localStorage` per-entity default").
 *
 * `resolveViewMode` is the pure precedence rule (URL → localStorage → default)
 * and is unit-tested; `useViewMode` is the thin client hook that wires it to
 * `useSearchParams` + `localStorage` and returns a `[mode, setMode]` pair.
 */

const VALID: readonly ViewMode[] = ['kanban', 'table', 'list']

/** Narrow an arbitrary string to a {@link ViewMode} that this list supports. */
function supported(value: string | null, modes: ViewMode[]): ViewMode | null {
  if (!value) return null
  return (VALID as readonly string[]).includes(value) &&
    modes.includes(value as ViewMode)
    ? (value as ViewMode)
    : null
}

/**
 * Resolve the active view mode. Precedence: a valid, supported `?view=` value
 * wins; otherwise a valid, supported stored value; otherwise the entity's
 * default (`modes[0]`). Invalid or unsupported values at any tier are skipped.
 */
export function resolveViewMode(
  urlValue: string | null,
  stored: string | null,
  modes: ViewMode[]
): ViewMode {
  return supported(urlValue, modes) ?? supported(stored, modes) ?? modes[0]
}

/** localStorage key for an entity's remembered view preference. */
function storageKey(entity: string): string {
  return `view:${entity}`
}

/**
 * Client hook returning `[mode, setMode]`. Reads the initial mode from the URL
 * (shareable) falling back to the per-entity `localStorage` default; `setMode`
 * writes both the `?view=` query param (via `history.replaceState`, preserving
 * other params) and `localStorage`, and updates local state so the active view
 * re-renders without a server round-trip.
 */
export function useViewMode(
  entity: string,
  modes: ViewMode[]
): [ViewMode, (next: ViewMode) => void] {
  const searchParams = useSearchParams()
  const urlValue = searchParams.get('view')

  const [mode, setModeState] = useState<ViewMode>(() =>
    resolveViewMode(urlValue, null, modes)
  )

  // Reconcile with the stored default once mounted (localStorage is
  // client-only, so it is unavailable during the initial render).
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(storageKey(entity))
    } catch {
      stored = null
    }
    setModeState(resolveViewMode(urlValue, stored, modes))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, urlValue])

  const setMode = useCallback(
    (next: ViewMode) => {
      if (!modes.includes(next)) return
      setModeState(next)
      try {
        window.localStorage.setItem(storageKey(entity), next)
      } catch {
        // Ignore storage failures (private mode / quota); URL still carries it.
      }
      const params = new URLSearchParams(window.location.search)
      params.set('view', next)
      const query = params.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`
      )
    },
    [entity, modes]
  )

  return [mode, setMode]
}
