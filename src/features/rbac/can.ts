import type {
  Capability,
  ModuleKey,
  ModulePermission,
  Permissions,
  RecordScope,
  ScopedModulePermission,
} from '@/lib/supabase/types'

/**
 * Pure, dependency-free permission logic (spec §6.1). No `server-only` import so
 * it is unit-testable and importable from client components (nav filtering).
 * NEVER trust a raw permissions blob — always run it through
 * `normalizePermissions` first, which fails closed against DEFAULT_DENY_ALL.
 */

/** Nav/gating order; also the order `firstAllowedModule` scans. */
export const MODULE_ORDER: ModuleKey[] = [
  'products',
  'forms',
  'leads',
  'deals',
  'contacts',
  'settings',
  'automation',
]

/** Record modules carry a scope; everything else is plain view/edit. */
const SCOPED_MODULES: ReadonlyArray<'leads' | 'deals'> = ['leads', 'deals']

/** A fully-denied matrix; the safe default for missing/corrupt permissions. */
export const DEFAULT_DENY_ALL: Permissions = {
  products: { view: false, edit: false },
  forms: { view: false, edit: false },
  leads: { view: false, edit: false, scope: 'own' },
  deals: { view: false, edit: false, scope: 'own' },
  contacts: { view: false, edit: false },
  settings: { view: false, edit: false },
  automation: { view: false, edit: false },
}

function asBool(v: unknown): boolean {
  return v === true
}

function asScope(v: unknown): RecordScope {
  return v === 'all' ? 'all' : 'own'
}

/**
 * Deep-merge an unknown/partial blob onto DEFAULT_DENY_ALL. Only known modules
 * are read, only `true` counts as granted, and scope defaults to the safest
 * value (`own`). The result can never grant more than the input explicitly did.
 */
export function normalizePermissions(raw: unknown): Permissions {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_DENY_ALL)
  }
  const src = raw as Record<string, unknown>
  const out = structuredClone(DEFAULT_DENY_ALL)

  for (const mod of MODULE_ORDER) {
    const m = src[mod]
    if (!m || typeof m !== 'object') continue
    const mm = m as Record<string, unknown>
    const base: ModulePermission = {
      view: asBool(mm.view),
      edit: asBool(mm.edit),
    }
    if (SCOPED_MODULES.includes(mod as 'leads' | 'deals')) {
      ;(out[mod] as ScopedModulePermission) = {
        ...base,
        scope: asScope(mm.scope),
      }
    } else {
      ;(out[mod] as ModulePermission) = base
    }
  }
  return out
}

/** True when the role grants `capability` on `module`. */
export function can(
  perms: Permissions,
  module: ModuleKey,
  capability: Capability
): boolean {
  return perms[module]?.[capability] === true
}

/** The record scope for a record module. */
export function scopeFor(
  perms: Permissions,
  module: 'leads' | 'deals'
): RecordScope {
  return perms[module].scope
}

/**
 * The owner id a list/detail query must filter on, or null for no filter.
 * Returns `userId` when the module scope is `own`, else null (scope `all`).
 */
export function ownerScopeFilter(
  perms: Permissions,
  module: 'leads' | 'deals',
  userId: string
): string | null {
  return scopeFor(perms, module) === 'own' ? userId : null
}

/** First module (in MODULE_ORDER) the role can view, or null. */
export function firstAllowedModule(perms: Permissions): ModuleKey | null {
  return MODULE_ORDER.find((m) => can(perms, m, 'view')) ?? null
}

/** Route path for a module. */
export function modulePath(module: ModuleKey): string {
  if (module === 'settings') return '/admin/settings'
  if (module === 'automation') return '/admin/settings/automation'
  // The `deals` module keeps its key/table, but its route is /admin/interest.
  if (module === 'deals') return '/admin/interest'
  return `/admin/${module}`
}
