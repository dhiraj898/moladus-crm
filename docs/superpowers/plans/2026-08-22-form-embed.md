# Form Embed (Spec 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public enrollment form (`/f/[slug]` + thank-you) embeddable in third-party sites via `<iframe>` while keeping `/admin` and the API un-framable, add a copy-paste snippet generator to the form builder, and add a per-form `hide_price` toggle that suppresses the header cost estimate on the public form.

**Architecture:** Two independent, small capabilities on the existing Form Engine. (1) **Framing** is configured entirely in `next.config.ts` via `headers()` — disjoint per-route rules: `frame-ancestors 'none'` + `X-Frame-Options: DENY` on `/admin/:path*` and `/api/:path*`, `frame-ancestors *` (no XFO) on `/f/:path*`. Middleware (`src/middleware.ts`) is untouched. (2) **hide_price** is one boolean column on `forms`, flowing through the existing `formSchema` → `createForm`/`updateForm` → `FormMetaForm` path, and gating the estimate render in `src/app/f/[slug]/page.tsx`. The builder gains an **Embed** card driven by a pure `buildEmbedSnippet()` helper (unit-tested). Auto-height `postMessage` resize is documented but deferred; v1 uses a fixed min-height.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS (service-role, server-only), Zod, Vitest, Tailwind (design tokens).

## Global Constraints

- Node 20+; Next.js 15 App Router; TypeScript strict.
- Supabase accessed ONLY server-side via `getServiceClient()`. RLS deny-all on `forms` (already enabled); this spec adds no table and no policy.
- Mutating server actions assert authorization via `getCurrentUser()`; actions return `ActionResult<T> = {ok:true,data:T} | {ok:false,error:string, fieldErrors?}`. No action signatures change — `createForm`/`updateForm` already spread `parsed.data`, so `hide_price` flows through once it is in `formSchema`.
- Design system: Inter, dark-default tokens, `--accent:#ff4500`, colors via CSS vars. New builder UI (toggle + Embed card) matches the existing `FormMetaForm` / Stages / FieldConfigurator styling (`inputClass`, `labelClass`, `rounded-[8px]`, `border-line`, `text-dim`).
- Migration `0007_form_embed.sql` is a SQL file applied out-of-band; do NOT run it in a gate; the build must stay green without it (the `Form` type is hand-authored).
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build` (+ `npm run test` where tests exist).
- Never run `npm run dev` or any long-running server in a gate.

---

## File Structure

- `supabase/migrations/0007_form_embed.sql` — add `forms.hide_price boolean not null default false`.
- `next.config.ts` — add `async headers()` with the three per-route framing rules.
- `src/lib/supabase/types.ts` — add `hide_price: boolean` to `Form`.
- `src/features/forms/schema.ts` — add `hide_price` to `formSchema`.
- `src/features/forms/FormMetaForm.tsx` — add the hide-price checkbox to Details.
- `src/features/forms/embed.ts` (+ `embed.test.ts`) — pure `buildEmbedSnippet()` + `EMBED_DEFAULTS`.
- `src/features/forms/EmbedSnippet.tsx` — client card: snippet textarea + copy + note.
- `src/app/f/[slug]/page.tsx` — gate the estimate on `!form.hide_price`.
- `src/app/admin/forms/[id]/page.tsx` — render the Embed section (published-only).

---

## Workstream 1: db (migration + types + schema)

### Task 1.1: Migration 0007_form_embed.sql

**Files:**
- Create: `supabase/migrations/0007_form_embed.sql`

**Interfaces:**
- Produces (DB): `forms.hide_price boolean not null default false`. RLS unaffected.

- [ ] **Step 1: Write the migration** (verbatim):

```sql
-- 0007_form_embed.sql — Form Embed (Spec 5). Apply out-of-band.

-- Per-form toggle: when true, the public form (/f/[slug]) hides the product
-- cost estimate in its header. Pricing/GST + payment amounts are unaffected.
alter table forms
  add column if not exists hide_price boolean not null default false;
```

- [ ] **Step 2: Do NOT apply** in a gate. Record in the ENV-PENDING list.

### Task 1.2: Type + schema for hide_price

**Files:**
- Modify: `src/lib/supabase/types.ts`
- Modify: `src/features/forms/schema.ts`

**Interfaces:**
- Produces: `Form.hide_price: boolean`; `formSchema` now parses/emits `hide_price` (default `false`); `FormInput`/`FormInputRaw` gain the field automatically via `z.infer`/`z.input`.
- Consumed by: `FormMetaForm` (WS3), `createForm`/`updateForm` (unchanged — spread `parsed.data`), the public page (WS2).

- [ ] **Step 1: types.ts** — add `hide_price: boolean` to the `Form` interface, positioned after `submit_label` and before `created_at` (mirrors the DDL column order). Typed `boolean` (not nullable) because the column is `not null default false`.

- [ ] **Step 2: schema.ts** — add to the `formSchema` object, alongside `submit_label`:

```ts
  hide_price: z.coerce.boolean().default(false),
```

- [ ] **Step 3: Gates** — lint + type-check + build (build stays green without the migration applied).
- [ ] **Step 4: Commit** — `git commit -am "feat(forms): add hide_price column, type, and schema (Spec 5)"`

---

## Workstream 2: framing + public page

### Task 2.1: Frame-protection headers in next.config.ts

**Files:**
- Modify: `next.config.ts`

**Interfaces:**
- Produces: `/f/:path*` framable cross-origin (`frame-ancestors *`, no XFO); `/admin/:path*` and `/api/:path*` un-framable (`X-Frame-Options: DENY` + `frame-ancestors 'none'`). Source patterns are disjoint — no header conflict.

- [ ] **Step 1: Replace `next.config.ts`** with (verbatim):

```ts
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
 * browsers honor over XFO where both are present). Source patterns are disjoint,
 * so /f/* never inherits the deny rules.
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

- [ ] **Step 2: Leave `src/middleware.ts` unchanged** — it owns auth for `/admin` + `/api/admin`, never runs on `/f/*`, and must not gain header logic.
- [ ] **Step 3: Gates** — lint + type-check + build.
- [ ] **Step 4: Commit** — `git commit -am "feat(security): frame /f publicly, deny framing on /admin + /api (Spec 5)"`

### Task 2.2: Respect hide_price on the public form

**Files:**
- Modify: `src/app/f/[slug]/page.tsx`

**Interfaces:**
- Consumes: `form.hide_price` (from `getPublishedFormBySlug`, which selects `*`).
- Produces: the header cost-estimate block is not rendered (and not computed) when `hide_price` is true.

- [ ] **Step 1: Gate the estimate.** Change:

```ts
const estimate = product ? estimatePrice(product) : null
```

to:

```ts
const estimate = product && !form.hide_price ? estimatePrice(product) : null
```

The existing `{estimate ? ( … ) : null}` block then renders nothing when hidden. No other change: product name, kicker, `FormRunner`, and `generateMetadata` are untouched.

- [ ] **Step 2: Gates** — lint + type-check + build.
- [ ] **Step 3: Commit** — `git commit -am "feat(form): hide cost estimate on public form when hide_price is set (Spec 5)"`

---

## Workstream 3: builder UI (toggle + embed snippet)

### Task 3.1: Hide-price toggle in Details

**Files:**
- Modify: `src/features/forms/FormMetaForm.tsx`

**Interfaces:**
- Consumes: `form?.hide_price`; produces `hide_price` in the `FormInputRaw` payload passed to `createForm`/`updateForm`.

- [ ] **Step 1: State** — add `const [hidePrice, setHidePrice] = useState(form?.hide_price ?? false)`.
- [ ] **Step 2: Payload** — add `hide_price: hidePrice,` to the `input: FormInputRaw` object in `handleSubmit` (next to `submit_label`).
- [ ] **Step 3: UI** — add a checkbox row after the Submit-label field, styled to match:

```tsx
<label className="flex items-start gap-3">
  <input
    type="checkbox"
    checked={hidePrice}
    onChange={(e) => setHidePrice(e.target.checked)}
    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
  />
  <span className="flex flex-col gap-1">
    <span className={labelClass}>Hide price</span>
    <span className="text-xs text-dim">
      Hide the product cost estimate in the public form header.
    </span>
  </span>
</label>
```

- [ ] **Step 4: Gates** — lint + type-check + build.
- [ ] **Step 5: Commit** — `git commit -am "feat(forms): hide-price toggle in the builder Details (Spec 5)"`

### Task 3.2: Embed snippet helper + component + builder card

**Files:**
- Create: `src/features/forms/embed.ts`
- Create: `src/features/forms/embed.test.ts`
- Create: `src/features/forms/EmbedSnippet.tsx`
- Modify: `src/app/admin/forms/[id]/page.tsx`

**Interfaces:**
- Produces: `buildEmbedSnippet(opts)` (pure) and `EMBED_DEFAULTS`; `<EmbedSnippet src title />` client card; an Embed section on the builder (published-only).
- Consumes: the builder's existing `APP_URL` constant + `form.slug` + `form.status`.

- [ ] **Step 1: `embed.ts`** (pure helper — no React, unit-testable):

```ts
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
```

- [ ] **Step 2: `embed.test.ts`** (Vitest — real test, green without env):

```ts
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
```

- [ ] **Step 3: `EmbedSnippet.tsx`** (client component; reuses the CopyLinkButton copy pattern, matches builder styling):

```tsx
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
```

- [ ] **Step 4: Builder page** — in `src/app/admin/forms/[id]/page.tsx`, import `EmbedSnippet`, and add an Embed section. Render the snippet only when `form.status === 'published'` (a draft `/f/[slug]` 404s in the frame); otherwise show a muted note. Place it after the Details section:

```tsx
<section className="mb-12">
  <h2 className="mb-4 text-lg font-bold tracking-[-0.01em]">Embed</h2>
  {form.status === 'published' ? (
    <EmbedSnippet src={`${APP_URL}/f/${form.slug}`} title={form.name} />
  ) : (
    <p className="text-sm text-dim">
      Publish this form to get an embeddable iframe snippet.
    </p>
  )}
</section>
```

- [ ] **Step 5: Gates** — lint + type-check + build + `npm run test` (embed.test.ts).
- [ ] **Step 6: Commit** — `git commit -am "feat(forms): iframe embed snippet generator in the builder (Spec 5)"`

---

## Self-Review Notes

- **Spec coverage:** §4 (`hide_price` column) → WS1; §5 framing headers → WS2.1; §6 public-page gate → WS2.2; §7.1 toggle → WS3.1; §7.2 snippet helper + card → WS3.2; §7.3 auto-height → documented, deferred (not built); §8 testing → embed.test.ts (WS3.2) + ENV-PENDING manual; §9 security → framing config (WS2.1) + estimate not computed when hidden (WS2.2). All in-scope items covered.
- **Framing mechanism:** chosen in `next.config.ts headers()` with disjoint source patterns (`/admin/:path*`, `/api/:path*` deny; `/f/:path*` allow) — no header conflict, no ordering dependency, middleware untouched. `/f/*` deliberately omits `X-Frame-Options` (no "allow any" value) and relies on `frame-ancestors *`.
- **Type consistency:** `hide_price: boolean` (non-null) matches the `not null default false` DDL; `formSchema` uses `z.coerce.boolean().default(false)`; `FormInput`/`FormInputRaw` inherit it via `z.infer`/`z.input`, so `createForm`/`updateForm` need no signature change (they spread `parsed.data`). `FormMetaForm` seeds from `form?.hide_price ?? false`.
- **No behaviour regression:** `createForm`/`updateForm` still force/preserve status; `hide_price` is display-only and cannot affect status, pricing, routing, or payment amounts (payment amount is derived server-side from the product at ingest, independent of this toggle). Existing form/ingest/GST tests stay green.
- **Build without migration:** the `Form` type is hand-authored to include `hide_price`, so type-check/build pass before `0007` is applied; `getPublishedFormBySlug` selects `*`, so no query change is needed.
- **Placeholder scan:** no TBD/TODO; every code step is concrete.
- **ENV-PENDING:** apply migration `0007_form_embed.sql`; confirm `NEXT_PUBLIC_APP_URL` is the production origin; verify embedding in a real third-party page on a different origin (framing allowed for `/f/*`, blocked for `/admin` + `/api`); verify the `hide_price` toggle end-to-end. Optional future work: restrict `frame-ancestors *` to a partner allowlist; ship the auto-height `postMessage` resize (§7.3).
```
