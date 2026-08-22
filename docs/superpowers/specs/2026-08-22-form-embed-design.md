# Spec 5 — Form Embed (iframe) + Hide-Price Toggle — Design

**Date:** 2026-08-22
**Status:** Draft (awaiting review)
**Phase:** 5 of 6 in the roadmap. Builds on the Form Engine (`/f/[slug]`, `FormRunner`, `forms`/`form_fields`, the form builder under `/admin/forms/[id]`) and the frame-protection/auth boundary in `src/middleware.ts`.

---

## 1. Goal

Let the public enrollment form be dropped into any third-party website with a copy-paste `<iframe>` snippet generated in the form builder, and let an admin hide the product cost estimate on a per-form basis (some campaigns want a "request info" feel with no price shown up front).

Two small, independent capabilities:

1. **Hide-price** — a per-form boolean that suppresses the header cost estimate on `/f/[slug]`.
2. **Embed** — make `/f/[slug]` (and its thank-you page) framable cross-origin while keeping `/admin` and the API un-framable, plus a snippet generator in the builder.

No new tables beyond one column; no change to ingest, payments, or automation.

---

## 2. Scope

**In scope**
- `forms.hide_price` boolean column (migration `0007_form_embed.sql`), wired through the Zod schema, the form-meta action path, the builder Details toggle, and the public page render.
- Frame-protection headers configured in `next.config.ts` so **only** `/f/:path*` is framable cross-origin; `/admin/:path*` and `/api/:path*` are `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
- An **Embed** card in the form builder: a read-only, copy-able `<iframe>` snippet using `NEXT_PUBLIC_APP_URL/f/{slug}` with a sensible width/height and a note about responsive resizing. Shown only when the form is published (a draft `/f/[slug]` 404s).
- A pure `buildEmbedSnippet()` helper (unit-tested) so the snippet string is deterministic and testable without a browser.

**Out of scope (deferred / nice-to-have)**
- **Auto-height postMessage resize** — documented in §7 as a nice-to-have. v1 ships a fixed min-height; auto-resize is optional and can land later without a schema change.
- A per-form **embed allowlist** (restricting which parent origins may frame the form). v1 allows any parent (`frame-ancestors *`) because the form is already fully public; tightening to an allowlist is an ENV-PENDING/next-spec option (§8).
- Any change to field rendering, ingest, GST, payments, or automation.
- Theming the embed to the host site (the form keeps its own dark-default design tokens inside the frame).

---

## 3. Locked decisions

1. Hide-price is a **form-level** boolean `hide_price` (default `false`), not per-field and not a product setting.
2. Only the **cost-estimate block** in the `/f/[slug]` header is suppressed when `hide_price` is true; the product name / "Enrollment" kicker and the whole form still render. Pricing/GST computation and the ingest/payment path are unchanged (payment link amount is still derived server-side from the product).
3. Frame protection is added in **`next.config.ts` `headers()`** (per-route), not in middleware. Middleware stays focused on auth and is left untouched (it never runs on `/f/*` and editing it risks the auth-cookie handling).
4. The public form uses the modern **CSP `frame-ancestors`** directive as the source of truth for framing; `X-Frame-Options` is set to `DENY` only on the protected routes and deliberately **omitted** on `/f/*` (XFO has no "allow any origin" value, and a present-but-invalid XFO is treated as DENY by some browsers).
5. v1 embed uses a **fixed min-height** (default 720px, `width: 100%`); auto-resize via `postMessage` is a documented nice-to-have (§7).
6. The snippet generator is shown only for **published** forms (mirrors the existing `CopyLinkButton` gating), since a draft `/f/[slug]` 404s inside the iframe.

---

## 4. Data model

New migration: `supabase/migrations/0007_form_embed.sql`. Applied out-of-band; the build stays green without applying it (the type change is hand-authored). RLS is unaffected — `forms` already has RLS enabled (deny-all; service-role only).

```sql
-- 0007_form_embed.sql — Form Embed (Spec 5). Apply out-of-band.

-- Per-form toggle: when true, the public form (/f/[slug]) hides the product
-- cost estimate in its header. Pricing/GST + payment amounts are unaffected.
alter table forms
  add column if not exists hide_price boolean not null default false;
```

### `src/lib/supabase/types.ts`

Add the column to the hand-authored `Form` interface (typed `boolean` — the column is `not null default false`, so never null):

```ts
export interface Form {
  id: string
  name: string
  slug: string
  product_id: string | null
  status: FormStatus | null
  welcome_message: string | null
  submit_label: string | null
  hide_price: boolean            // ← new (Spec 5)
  created_at: string | null
  updated_at: string | null
}
```

---

## 5. Framing-headers mechanism

Today `next.config.ts` sets **no** headers, so nothing is frame-protected. This spec adds an `async headers()` config that scopes framing per route group:

- `/admin/:path*` → `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`
- `/api/:path*` → `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`
- `/f/:path*` → `Content-Security-Policy: frame-ancestors *` and **no** `X-Frame-Options`

These source patterns are disjoint — `/f/*` never matches the admin/api rules — so there is no header conflict or ordering dependency. Any route outside these groups (e.g. `/admin/login`, still under `/admin/*`) is covered; the only public surface intentionally left framable is `/f/*`.

```ts
// next.config.ts
import type { NextConfig } from "next";

/**
 * Frame-protection headers (Spec 5 — Form embed).
 *
 * The public enrollment form (/f/[slug] + its thank-you) is MEANT to be
 * embedded in third-party sites via <iframe>, so it must permit cross-origin
 * framing. Everything else — the admin app (records + PII) and every API
 * route — must NOT be framable (clickjacking defense).
 *
 * X-Frame-Options has no "allow any origin" value (only DENY / SAMEORIGIN), and
 * a present-but-invalid value is treated as DENY by some browsers, so the public
 * form omits XFO entirely and relies on CSP `frame-ancestors *` (which modern
 * browsers honor over XFO where both are present).
 */
const denyFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/admin/:path*", headers: denyFraming },
      { source: "/api/:path*", headers: denyFraming },
      {
        source: "/f/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

**Why not middleware?** `src/middleware.ts` already owns auth for `/admin/:path*` and `/api/admin/:path*` and carefully copies Supabase auth cookies onto redirects. It never runs on `/f/*`, and adding response-header mutation there would entangle framing with the auth-cookie path for no benefit. `next.config.ts headers()` is the idiomatic place for static security headers and applies uniformly (including to statically-optimized responses).

---

## 6. Public form change (respect `hide_price`)

`src/app/f/[slug]/page.tsx` already computes `const estimate = product ? estimatePrice(product) : null` and renders the cost block only when `estimate` is truthy. Gate that block on the new toggle:

```tsx
const estimate = product && !form.hide_price ? estimatePrice(product) : null
```

The existing `{estimate ? ( … ) : null}` header block then renders nothing when `hide_price` is true — the product name and the rest of the form are unchanged. Nothing about pricing leaves the server: the estimate is simply not computed/rendered. `generateMetadata` and `FormRunner` are untouched. The thank-you page is untouched (it never shows a price).

---

## 7. Form builder changes

### 7.1 Hide-price toggle (Details section)

Add `hide_price` to the form input schema and the `FormMetaForm` Details UI:

- `src/features/forms/schema.ts` — add to `formSchema`:
  ```ts
  hide_price: z.coerce.boolean().default(false),
  ```
  (matches the existing `required`/`display_order` coercion pattern; `z.coerce.boolean()` maps a checkbox's boolean state cleanly.)
- `src/features/forms/FormMetaForm.tsx` — add a `hidePrice` state seeded from `form?.hide_price ?? false`, include `hide_price: hidePrice` in the `FormInputRaw` payload, and render a checkbox row styled like the rest of the Details form (label kicker + helper text: "Hide the product cost estimate on the public form"). `createForm`/`updateForm` need no logic change — they already spread `parsed.data` into the insert/update, so the new field flows through automatically.

### 7.2 Embed snippet generator (Embed card)

- New pure helper `src/features/forms/embed.ts`:
  ```ts
  /** Default embed frame size. width is a CSS value; height is px. */
  export const EMBED_DEFAULTS = { width: '100%', height: 720 } as const

  export function buildEmbedSnippet(opts: {
    src: string          // absolute, e.g. https://app.example/f/my-slug
    title: string        // accessible iframe title
    width?: string       // CSS width, default '100%'
    height?: number      // px, default 720
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
  ```
- New client component `src/features/forms/EmbedSnippet.tsx`: receives the absolute `src` and a `title`, renders a read-only `<textarea>` (or `<pre>`) showing `buildEmbedSnippet(...)`, plus a copy button reusing the `CopyLinkButton` pattern (copies the full snippet), plus a helper note:
  > "Paste this into any web page. The frame is full-width with a 720px minimum height; if your form is long, increase `min-height` or enable auto-resize (see docs)."
- `src/app/admin/forms/[id]/page.tsx`: it already computes `const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')` and renders `<CopyLinkButton url={`${APP_URL}/f/${form.slug}`} />` only when `form.status === 'published'`. Add an **Embed** `<section>` in the same published-only branch that renders `<EmbedSnippet src={`${APP_URL}/f/${form.slug}`} title={form.name} />`, styled as a card matching the Details / FieldConfigurator sections. For draft forms, show a short muted note that the form must be published before it can be embedded.

### 7.3 Auto-height postMessage (nice-to-have, deferred)

v1 ships the **fixed min-height** above. The optional auto-resize, if built later, is intentionally tiny and additive:

- **Sender** (add to `FormRunner`, guarded by `window.parent !== window`): after render and on each step/height change, `window.parent.postMessage({ type: 'molecule-form:height', height: document.body.scrollHeight }, '*')`.
- **Parent listener** (documented in the Embed card as an optional extra snippet the site owner pastes):
  ```html
  <script>
    window.addEventListener('message', (e) => {
      if (e?.data?.type === 'molecule-form:height') {
        document.querySelector('iframe[src*="/f/"]').style.height = e.data.height + 'px';
      }
    });
  </script>
  ```
- **Security note for when it ships:** the parent must validate `e.origin` against the known app origin before trusting `height`; the sender may target `'*'` (height is non-sensitive) but should ideally target the configured app URL. Because this requires the host site to paste extra JS and adds a cross-origin trust surface, it is deferred; the fixed min-height covers the common case with zero host-side scripting.

---

## 8. Testing

- **Unit (feasible, stays green without env):** `src/features/forms/embed.test.ts` — assert `buildEmbedSnippet` produces the expected `<iframe>` string for defaults and for custom width/height, and that the `src` is interpolated verbatim (guards against a broken snippet shipping to customers).
- **Type/build gate:** `hide_price` added to `Form` + `formSchema` must type-check across the builder and public page.
- **Manual / ENV-PENDING** (needs a deployed URL + a real third-party page):
  - Publish a form, copy the snippet, paste it into an external HTML page on a different origin, confirm the form renders and submits inside the iframe.
  - Confirm `/admin` and an `/api/*` URL **refuse** to frame (browser console shows the frame blocked by `X-Frame-Options`/`frame-ancestors`).
  - Toggle `hide_price` on and off and confirm the header cost estimate appears/disappears on `/f/[slug]` while payment amounts remain correct.

---

## 9. Security notes

- **Framing the form is safe:** `/f/[slug]` is already a fully public URL (anyone can open it directly), so permitting cross-origin framing exposes nothing new. It carries no admin session, no cookies of value, and reads only the published form via the service-role client server-side.
- **Admin stays un-framable:** the `X-Frame-Options: DENY` + `frame-ancestors 'none'` on `/admin/:path*` and `/api/:path*` prevents clickjacking of authenticated admin actions — a real risk because `/admin` holds records and PII. This is defense-in-depth on top of the existing middleware auth gate.
- **No price leak via hide_price:** when hidden, the estimate is never computed into the rendered HTML — it is not merely visually hidden. (The authoritative payment amount is still derived server-side at ingest from the bound product, independent of this display toggle.)
- **`hide_price` is display-only** and cannot change status, pricing, or routing; it flows through the same validated `formSchema` and service-role-only actions as the rest of the form metadata.

---

## 10. ENV-PENDING items

- Apply migration `0007_form_embed.sql` to the Supabase project; regenerate/confirm the `Form` type.
- Verify embedding in a **real third-party page** on a different origin (framing allowed for `/f/*`, blocked for `/admin` + `/api`).
- Confirm `NEXT_PUBLIC_APP_URL` is set to the production origin so generated snippets point at the right host.
- (Optional, future) Decide whether to restrict `frame-ancestors *` to an allowlist of partner origins, and/or ship the auto-height `postMessage` resize.
