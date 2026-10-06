import type { Config } from 'tailwindcss'

export default {
  // Dark is the default theme; `.light` on <html> opts into light (set by the
  // pre-paint OS script and the manual toggle). So Tremor's dark: variants are
  // active whenever that class is absent.
  darkMode: ['selector', ':root:not(.light)'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  // Tremor builds chart series classes at runtime (`fill-orange-500`,
  // `stroke-amber-500`, `bg-blue-500`, ...) via template literals Tailwind's
  // scanner can't see, so JIT purges them. Safelist the palettes passed to
  // charts in DashboardViews.tsx. Keep this list in sync with DONUT_COLORS.
  safelist: [
    {
      pattern:
        /^(bg|text|border|ring|stroke|fill)-(orange|amber|blue|cyan|violet|emerald|rose)-(400|500|600|700|800|900)$/,
      variants: ['hover', 'ui-selected', 'dark'],
    },
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        line: 'var(--line)',
        text: 'var(--text)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        accent: 'var(--accent)',
        red: 'var(--red)',
        amber: 'var(--amber)',
        green: 'var(--green)',
        'chip-bg': 'var(--chip-bg)',

        // Tremor palette -> project tokens. Tremor reads `tremor-*` in light
        // and `dark-tremor-*` under the dark selector; both point at the same
        // CSS variables so a single token set drives either theme.
        tremor: {
          brand: {
            faint: 'var(--surface2)',
            muted: 'var(--chip-bg)',
            subtle: 'var(--accent)',
            DEFAULT: 'var(--accent)',
            emphasis: 'var(--accent)',
            inverted: 'var(--bg)',
          },
          background: {
            muted: 'var(--surface2)',
            subtle: 'var(--surface2)',
            DEFAULT: 'var(--surface)',
            emphasis: 'var(--dim)',
          },
          border: { DEFAULT: 'var(--line)' },
          ring: { DEFAULT: 'var(--line)' },
          content: {
            subtle: 'var(--faint)',
            DEFAULT: 'var(--dim)',
            emphasis: 'var(--text)',
            strong: 'var(--text)',
            inverted: 'var(--bg)',
          },
        },
        'dark-tremor': {
          brand: {
            faint: 'var(--surface2)',
            muted: 'var(--chip-bg)',
            subtle: 'var(--accent)',
            DEFAULT: 'var(--accent)',
            emphasis: 'var(--accent)',
            inverted: 'var(--bg)',
          },
          background: {
            muted: 'var(--surface2)',
            subtle: 'var(--surface2)',
            DEFAULT: 'var(--surface)',
            emphasis: 'var(--dim)',
          },
          border: { DEFAULT: 'var(--line)' },
          ring: { DEFAULT: 'var(--line)' },
          content: {
            subtle: 'var(--faint)',
            DEFAULT: 'var(--dim)',
            emphasis: 'var(--text)',
            strong: 'var(--text)',
            inverted: 'var(--bg)',
          },
        },
      },
      fontFamily: {
        sans: ['InterVariable', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
