import { z } from 'zod'

/**
 * Zod schemas for the RBAC admin screens (spec §10 — Roles / Users).
 *
 * `permissionsSchema` mirrors the `Permissions` matrix in
 * `src/lib/supabase/types.ts`: every module has `view` + `edit` booleans, and
 * the record modules (`leads`, `deals`) additionally carry an `all | own`
 * scope. Actions still run the parsed blob through `normalizePermissions`
 * (fail-closed) before persisting, so a shape that validates here can never
 * widen access beyond what it explicitly declares.
 */

/** view/edit for a plain (non-record) module. */
const modulePermissionSchema = z.object({
  view: z.boolean(),
  edit: z.boolean(),
})

/** view/edit + record scope for the record modules (leads, deals). */
const scopedModulePermissionSchema = modulePermissionSchema.extend({
  scope: z.enum(['all', 'own']),
})

/** The full per-module matrix stored in `roles.permissions`. */
export const permissionsSchema = z.object({
  products: modulePermissionSchema,
  forms: modulePermissionSchema,
  leads: scopedModulePermissionSchema,
  deals: scopedModulePermissionSchema,
  contacts: modulePermissionSchema,
  settings: modulePermissionSchema,
  automation: modulePermissionSchema,
})

/**
 * Role create/update input. Only `name` is user-authored here — the permission
 * matrix and the assignment-pool flag are edited through their own actions
 * (`updateRolePermissions`, `setRoleAssignmentPool`).
 */
export const roleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
})

/** Parsed, validated permissions matrix. */
export type PermissionsInput = z.infer<typeof permissionsSchema>
/** Parsed, validated role input (post-transform). */
export type RoleInput = z.infer<typeof roleSchema>
/** Raw, pre-parse role shape accepted by the schema (what callers pass in). */
export type RoleInputRaw = z.input<typeof roleSchema>
