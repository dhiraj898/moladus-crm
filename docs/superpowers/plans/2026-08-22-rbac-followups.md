# RBAC Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an in-app "Invite user" flow (admin provisions a teammate's Supabase Auth account + role without leaving the CRM), and harden the permission resolver so a transient DB error never shows a valid user the misleading "no access to any modules" screen.

**Architecture:** Builds on merged RBAC (Spec 3). Reuses `requirePermission('settings','edit')`, `getServiceClient()`, the existing Users screen (`/admin/settings/users`) and `assignUserRole`. Invite uses Supabase Auth admin `inviteUserByEmail` (no password handled in our app). Resolver hardening is a localized change in `src/features/rbac/permissions.ts`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS admin API, Zod, Tailwind (design tokens).

## Global Constraints

- Supabase server-side only via `getServiceClient()`; RLS deny-all backstop.
- Every mutating action asserts `requirePermission('settings','edit')` first.
- No password handling in the app — invite via `auth.admin.inviteUserByEmail` (emails a set-password link). Never store or display a password.
- Design system: Inter, dark-default tokens, `--accent:#ff4500`, CSS vars, row-border tables — match the existing Users/Stages editors.
- Gates per task: `cd '/Users/dhirajghosal/Documents/Molades CRM' && npm run lint && npm run type-check && npm run build`.
- No new migration (uses existing roles/profiles). Never run `npm run dev` in a gate.

---

## File Structure
- Modify: `src/features/rbac/permissions.ts` — resolver: retry-once on DB error + distinguish transient error from no-profile.
- Modify: `src/app/admin/no-access/page.tsx` — softer copy.
- Create: `src/features/rbac/inviteUser.ts` (or add `inviteUser` to `src/features/rbac/actions.ts`) — the invite action.
- Modify: `src/app/admin/settings/users/{page.tsx, UsersEditor.tsx}` — add the invite form.

---

## Workstream 1: resolver hardening + no-access copy

### Task 1.1: Resolver retry + clearer failure

**Files:**
- Modify: `src/features/rbac/permissions.ts`, `src/app/admin/no-access/page.tsx`

**Interfaces:**
- `getCurrentUserWithRole()` unchanged signature. Behaviour: on a `profiles` lookup `error`, retry the query ONCE; only if it still errors, return the deny-all fallback. (No-profile — a successful query with no row — remains a legitimate deny-all, unchanged.)

- [ ] **Step 1:** In `getCurrentUserWithRole`, wrap the `profiles` select so that when `error` is truthy it retries the same query once before falling back to `DEFAULT_DENY_ALL`. Keep the no-row path (successful query, `roleRow` null) exactly as-is.
- [ ] **Step 2:** Soften `src/app/admin/no-access/page.tsx` copy to: heading "No access to this section", body "Your role doesn't grant access here. If you think this is a mistake, refresh or contact your administrator." (design tokens; keep the centered card).
- [ ] **Step 3: Gates** — lint + type-check + build
- [ ] **Step 4: Commit** — `git commit -am "fix(rbac): retry resolver on transient DB error; clearer no-access copy"`

---

## Workstream 2: invite user

### Task 2.1: inviteUser action

**Files:**
- Modify: `src/features/rbac/actions.ts` (append `inviteUser`)
- Create: `src/features/rbac/inviteSchema.ts` (or inline Zod)

**Interfaces:**
- Consumes: `requirePermission`, `getServiceClient`, `assignUserRole` (or direct profiles upsert).
- Produces: `inviteUser(input: { email: string; roleId: string | null }): Promise<ActionResult<{ userId: string }>>`.

- [ ] **Step 1:** Validate `email` (Zod email) + optional `roleId` (uuid or null). Assert `requirePermission('settings','edit')`.
- [ ] **Step 2:** Call `getServiceClient().auth.admin.inviteUserByEmail(email)`. On error: map "already been registered"/"already exists" to a friendly `{ok:false,error:'A user with this email already exists.'}`; map an SMTP/not-configured error to `{ok:false,error:'Could not send the invite email — check Supabase email settings.'}` (surface the provider message when unclear).
- [ ] **Step 3:** On success, take the returned `data.user.id`; if `roleId` provided, upsert `profiles(user_id, role_id)` (onConflict user_id) so the invited user has their role immediately. `revalidatePath('/admin/settings/users')`. Return `{ok:true,data:{userId}}`.
- [ ] **Step 4: Gates** — lint + type-check + build
- [ ] **Step 5: Commit** — `git commit -am "feat(rbac): inviteUser admin action (Supabase invite + role assign)"`

### Task 2.2: Invite form in Users screen

**Files:**
- Modify: `src/app/admin/settings/users/page.tsx`, `src/app/admin/settings/users/UsersEditor.tsx`

**Interfaces:**
- Consumes: `inviteUser`, `listRoles`.
- Produces: an "Invite user" form above/below the users table: email input + role select (roles from listRoles, plus "No role") + Invite button; inline success ("Invite sent to …") and error (`role="alert"`); `isPending` disabled state. On success, `router.refresh()` so the new user appears in the table.

- [ ] **Step 1:** Load roles in `page.tsx` (already loaded for the table) and pass to `UsersEditor`.
- [ ] **Step 2:** Add the invite form to `UsersEditor` (client) calling `inviteUser`; show success/error inline; refresh on success.
- [ ] **Step 3: Gates** — lint + type-check + build
- [ ] **Step 4: Commit** — `git commit -am "feat(rbac): invite-user form in Settings → Users"`

---

## ENV-PENDING
- `inviteUserByEmail` sends a real email only if Supabase Auth SMTP is configured (Supabase uses a shared limited sender by default; a custom SMTP is recommended for production). Manual: from Settings → Users, invite a test email, confirm the invite email arrives and its link lets the user set a password and sign in; confirm the assigned role is in effect. If SMTP is not set up, the action surfaces the provider error.

## Self-Review Notes
- Invite handles account creation via Supabase's own invite (no password in our app) — aligns with the "no credential handling in-app" constraint.
- Resolver change is minimal (retry once) and preserves fail-closed semantics (still denies on persistent error / no profile).
- No new migration; reuses roles/profiles + existing assignUserRole pattern.
