/** Default embed frame size. `width` is any CSS value; `height` is px. */
export const EMBED_DEFAULTS = { width: '100%', height: 720 } as const

/** Build a copy-paste <iframe> snippet for a published form. */
export function buildEmbedSnippet(opts: {
  src: string
  title: string
  width?: string
  height?: number
}): string {
  const width = opts.width ?? EMBED_DEFAULTS.width
  const height = opts.height ?? EMBED_DEFAULTS.height
  return [
    `<iframe`,
    `  src="${opts.src}"`,
    `  title="${opts.title}"`,
    `  style="width:${width};min-height:${height}px;border:0;"`,
    `  loading="lazy"`,
    `></iframe>`,
  ].join('\n')
}
