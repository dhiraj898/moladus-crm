'use client'

import { useEffect, useState } from 'react'

/**
 * Manual light/dark toggle. Dark is the default; the pre-paint script in the
 * root layout adds `.light` when the OS prefers light. This button lets a user
 * override that choice for the session.
 */
export default function ThemeToggle() {
  const [light, setLight] = useState(false)

  // Sync initial state with whatever the pre-paint script already decided.
  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'))
  }, [])

  function toggle() {
    const next = !document.documentElement.classList.contains('light')
    document.documentElement.classList.toggle('light', next)
    setLight(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="fixed right-4 top-4 z-50 flex-shrink-0 cursor-pointer rounded-[99px] border border-line bg-surface px-[18px] py-[9px] text-xs font-semibold text-text hover:border-faint"
    >
      {light ? '◐ dark mode' : '◐ light mode'}
    </button>
  )
}
