'use client'

import { useState } from 'react'
import { buildEmbedSnippet } from './embed'

/** Read-only <iframe> snippet with copy-to-clipboard, shown for published forms. */
export default function EmbedSnippet({
  src,
  title,
}: {
  src: string
  title: string
}) {
  const snippet = buildEmbedSnippet({ src, title })
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    setFailed(false)
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface2 p-4">
      <textarea
        readOnly
        rows={6}
        value={snippet}
        onFocus={(e) => e.currentTarget.select()}
        className="resize-none rounded-[8px] border border-line bg-surface px-3.5 py-2.5 font-mono text-[13px] leading-[1.6] text-text outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-dim">
          Paste into any web page. The frame is full-width with a 720px minimum
          height — increase <code>min-height</code> for long forms.
        </p>
        <button
          type="button"
          onClick={copy}
          className="flex-shrink-0 rounded-[8px] border border-line px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:text-text"
        >
          {failed ? 'Copy failed' : copied ? 'Copied ✓' : 'Copy snippet'}
        </button>
      </div>
    </div>
  )
}
