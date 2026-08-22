'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/types'
import type { AssignableUser } from '@/features/rbac/queries'
import { assignUserRole } from '@/features/rbac/actions'

/**
 * Users editor (spec §10.2 / plan Task 6.3). A row-border table of admin users
 * (email + current role) with a role `<select>` per row that calls
 * `assignUserRole(userId, roleId)`. Same transition / inline-error pattern as
 * `StagesEditor` / `RolesEditor`; the empty value maps to "no role" (`null`).
 * The self-lockout guard lives in the action — a failed change surfaces its
 * error inline and the select snaps back on the next refresh.
 */

const NO_ROLE = ''

export default function UsersEditor({
  users,
  roles,
}: {
  users: AssignableUser[]
  roles: Role[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleChange(userId: string, value: string) {
    setError(null)
    const roleId = value === NO_ROLE ? null : value
    startTransition(async () => {
      const result = await assignUserRole(userId, roleId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Users</h2>
        <p className="mt-1 text-sm text-dim">
          Map each admin user to a role. A user with no role has no access until
          one is assigned. The last administrator cannot be demoted.
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

      {users.length === 0 ? (
        <div className="rounded-[12px] border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No users yet</p>
          <p className="mt-1 text-sm text-dim">
            Users appear here after they sign in for the first time.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold text-dim">User</th>
                <th className="px-4 py-3 font-semibold text-dim">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-4 py-3 align-middle">
                    <span className="font-medium text-text">
                      {user.email ?? user.id}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <select
                      value={user.roleId ?? NO_ROLE}
                      disabled={isPending}
                      onChange={(e) => handleChange(user.id, e.target.value)}
                      aria-label={`Role for ${user.email ?? user.id}`}
                      className="rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value={NO_ROLE}>No role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
