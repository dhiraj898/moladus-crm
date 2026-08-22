'use client'

import { useState } from 'react'

/**
 * Copies a form's public URL to the clipboard and shows a transient
 * confirmation. Used on the form list + builder screens.
 */
export default function CopyLinkButton({
  url,
  label = 'Copy link',
  className,
}: {
  url: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    setFailed(false)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setFailed(true)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      className={
        className ??
        'rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:text-text'
      }
    >
      {failed ? 'Copy failed' : copied ? 'Copied ✓' : label}
    </button>
  )
}
