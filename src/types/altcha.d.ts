import type React from 'react'

/**
 * JSX typing for the Altcha web component (design §Files).
 *
 * `import 'altcha'` registers the `<altcha-widget>` custom element and augments
 * `HTMLElementTagNameMap` for DOM lookups, but React's JSX namespace still needs
 * the intrinsic element declared so `<altcha-widget challengeurl … name …>`
 * type-checks. The widget needs only the public challenge URL — the server-only
 * `ALTCHA_HMAC_KEY` never reaches the client.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'altcha-widget': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          challengeurl?: string
          name?: string
          auto?: string
          theme?: string
        },
        HTMLElement
      >
    }
  }
}
