import { describe, it, expect } from 'vitest'
import { buildEmbedSnippet, EMBED_DEFAULTS } from './embed'

describe('buildEmbedSnippet', () => {
  it('uses defaults for width/height', () => {
    const s = buildEmbedSnippet({ src: 'https://app.test/f/demo', title: 'Demo' })
    expect(s).toContain('src="https://app.test/f/demo"')
    expect(s).toContain('title="Demo"')
    expect(s).toContain(`min-height:${EMBED_DEFAULTS.height}px`)
    expect(s).toContain(`width:${EMBED_DEFAULTS.width}`)
    expect(s.startsWith('<iframe')).toBe(true)
    expect(s.trimEnd().endsWith('></iframe>')).toBe(true)
  })

  it('honors custom width/height', () => {
    const s = buildEmbedSnippet({
      src: 'https://app.test/f/x',
      title: 'X',
      width: '600px',
      height: 900,
    })
    expect(s).toContain('width:600px;min-height:900px')
  })
})
