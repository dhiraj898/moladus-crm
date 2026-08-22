'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  Capability,
  ModuleKey,
  Permissions,
  Role,
} from '@/lib/supabase/types'
import { MODULE_ORDER } from '@/features/rbac/can'
import {
  createRole,
  updateRolePermissions,
  setRoleAssignmentPool,
  deleteRole,
} from '@/features/rbac/actions'

/**
 * Roles editor (spec §10.1 / plan Task 6.3). Mirrors `StagesEditor`: a
 * row-border table of roles with a create form, `useTransition` +
 * `router.refresh()`, and an inline `role="alert"` error banner. Each role
 * expands to a permission matrix (modules × View/Edit, plus an `all | own`
 * scope select for the record modules), an assignment-pool toggle, and a Delete
 * button. System roles (the seeded Admin) are read-only and non-deletable — the
 * actions refuse those writes server-side too, so the disabled controls only
 * mirror the authoritative guard.
 */

const inputClass =
  'rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent'

const labelClass = 'text-xs font-semibold uppercase tracking-[0.12em] text-dim'

/** Human labels for the module rows in the matrix. */
const MODULE_LABELS: Record<ModuleKey, string> = {
  products: 'Products',
  forms: 'Forms',
  leads: 'Leads',
  deals: 'Deals',
  contacts: 'Contacts',
  settings: 'Settings',
  automation: 'Automation',
}

/** Modules that carry a record scope. */
function isScoped(module: ModuleKey): module is 'leads' | 'deals' {
  return module === 'leads' || module === 'deals'
}

export default function RolesEditor({ roles }: { roles: Role[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')

  // Which role's matrix is expanded, plus the working draft for it.
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Permissions | null>(null)

  function run(
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    run(async () => {
      const result = await createRole({ name })
      if (result.ok) setNewName('')
      return result
    })
  }

  function toggleOpen(role: Role) {
    setError(null)
    if (openId === role.id) {
      setOpenId(null)
      setDraft(null)
      return
    }
    setOpenId(role.id)
    setDraft(structuredClone(role.permissions))
  }

  function setCapability(module: ModuleKey, capability: Capability, value: boolean) {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      next[module][capability] = value
      return next
    })
  }

  function setScope(module: 'leads' | 'deals', scope: 'all' | 'own') {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      next[module].scope = scope
      return next
    })
  }

  function savePermissions(id: string) {
    if (!draft) return
    run(async () => {
      const result = await updateRolePermissions(id, draft)
      if (result.ok) {
        setOpenId(null)
        setDraft(null)
      }
      return result
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Roles</h2>
        <p className="mt-1 text-sm text-dim">
          Each role carries a per-module permission matrix. Users map to one
          role. Records modules (Leads, Deals) also choose whether the role sees
          all records or only its own. The Admin role cannot be edited or
          deleted.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-line bg-surface px-4 py-3 text-sm text-red"
        >
          {error}
        </p>
      ) : null}

      {roles.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No roles yet</p>
          <p className="mt-1 text-sm text-dim">
            Add your first role below to start assigning access.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">Role</th>
                <th className="px-4 py-3 font-semibold text-dim">
                  Assignment pool
                </th>
                <th className="px-4 py-3 text-right font-semibold text-dim">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const open = openId === role.id
                return (
                  <RoleRows
                    key={role.id}
                    role={role}
                    open={open}
                    draft={open ? draft : null}
                    isPending={isPending}
                    onToggleOpen={() => toggleOpen(role)}
                    onTogglePool={(v) =>
                      run(() => setRoleAssignmentPool(role.id, v))
                    }
                    onDelete={() => run(() => deleteRole(role.id))}
                    onSetCapability={setCapability}
                    onSetScope={setScope}
                    onSave={() => savePermissions(role.id)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5"
      >
        <p className="text-sm font-semibold text-text">Add a role</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={labelClass}>Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sales Agent"
              maxLength={60}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Working…' : 'Add role'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The summary row for a role plus its expandable permission-matrix panel. */
function RoleRows({
  role,
  open,
  draft,
  isPending,
  onToggleOpen,
  onTogglePool,
  onDelete,
  onSetCapability,
  onSetScope,
  onSave,
}: {
  role: Role
  open: boolean
  draft: Permissions | null
  isPending: boolean
  onToggleOpen: () => void
  onTogglePool: (value: boolean) => void
  onDelete: () => void
  onSetCapability: (
    module: ModuleKey,
    capability: Capability,
    value: boolean
  ) => void
  onSetScope: (module: 'leads' | 'deals', scope: 'all' | 'own') => void
  onSave: () => void
}) {
  return (
    <>
      <tr className="border-b border-line last:border-b-0">
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text">{role.name}</span>
            {role.is_system ? (
              <span className="inline-flex items-center rounded-full bg-chip-bg px-2.5 py-0.5 text-xs font-medium text-accent">
                System
              </span>
            ) : null}
          </div>
        </td>

        <td className="px-4 py-3 align-middle">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-dim">
            <input
              type="checkbox"
              checked={role.in_assignment_pool}
              disabled={isPending}
              onChange={(e) => onTogglePool(e.target.checked)}
              className="h-4 w-4 accent-accent"
              aria-label={`${role.name} receives round-robin assignments`}
            />
            {role.in_assignment_pool ? 'In pool' : 'Excluded'}
          </label>
        </td>

        <td className="px-4 py-3 align-middle text-right">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={onToggleOpen}
              aria-expanded={open}
              className="text-sm font-medium text-accent transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {open ? 'Close' : 'Permissions'}
            </button>
            <button
              type="button"
              disabled={isPending || role.is_system}
              onClick={onDelete}
              title={
                role.is_system
                  ? 'System roles cannot be deleted.'
                  : undefined
              }
              className="text-sm font-medium text-dim transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>

      {open && draft ? (
        <tr className="border-b border-line last:border-b-0 bg-surface">
          <td colSpan={3} className="px-4 py-4">
            <PermissionMatrix
              draft={draft}
              disabled={isPending || role.is_system}
              onSetCapability={onSetCapability}
              onSetScope={onSetScope}
            />
            <div className="mt-4 flex items-center gap-3">
              {role.is_system ? (
                <p className="text-xs text-dim">
                  The Admin role always has full access and cannot be changed.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={onSave}
                  className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'Working…' : 'Save permissions'}
                </button>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** The modules × View/Edit(/scope) grid for one role's draft. */
function PermissionMatrix({
  draft,
  disabled,
  onSetCapability,
  onSetScope,
}: {
  draft: Permissions
  disabled: boolean
  onSetCapability: (
    module: ModuleKey,
    capability: Capability,
    value: boolean
  ) => void
  onSetScope: (module: 'leads' | 'deals', scope: 'all' | 'own') => void
}) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-4 py-2.5 font-semibold text-dim">Module</th>
            <th className="px-4 py-2.5 font-semibold text-dim">View</th>
            <th className="px-4 py-2.5 font-semibold text-dim">Edit</th>
            <th className="px-4 py-2.5 font-semibold text-dim">Scope</th>
          </tr>
        </thead>
        <tbody>
          {MODULE_ORDER.map((module) => {
            const perm = draft[module]
            const scoped = isScoped(module)
            return (
              <tr
                key={module}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-4 py-2.5 align-middle font-medium text-text">
                  {MODULE_LABELS[module]}
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <input
                    type="checkbox"
                    checked={perm.view}
                    disabled={disabled}
                    onChange={(e) =>
                      onSetCapability(module, 'view', e.target.checked)
                    }
                    className="h-4 w-4 accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`${MODULE_LABELS[module]} view`}
                  />
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <input
                    type="checkbox"
                    checked={perm.edit}
                    disabled={disabled}
                    onChange={(e) =>
                      onSetCapability(module, 'edit', e.target.checked)
                    }
                    className="h-4 w-4 accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`${MODULE_LABELS[module]} edit`}
                  />
                </td>
                <td className="px-4 py-2.5 align-middle">
                  {scoped && 'scope' in perm ? (
                    <select
                      value={perm.scope}
                      disabled={disabled}
                      onChange={(e) =>
                        onSetScope(
                          module,
                          e.target.value === 'all' ? 'all' : 'own'
                        )
                      }
                      aria-label={`${MODULE_LABELS[module]} scope`}
                      className="rounded-[8px] border border-line bg-surface2 px-2.5 py-1.5 text-sm text-text outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="own">Own records</option>
                      <option value="all">All records</option>
                    </select>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
