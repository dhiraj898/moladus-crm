'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/supabase/types'
import type { AssignableUser } from '@/features/rbac/queries'
import { assignUserRole, inviteUser } from '@/features/rbac/actions'

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

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleId, setInviteRoleId] = useState<string>(NO_ROLE)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [isInviting, startInvite] = useTransition()

  function handleInvite() {
    setInviteError(null)
    setInviteNotice(null)
    const email = inviteEmail.trim()
    if (!email) {
      setInviteError('Enter an email address.')
      return
    }
    startInvite(async () => {
      const result = await inviteUser({
        email,
        roleId: inviteRoleId === NO_ROLE ? null : inviteRoleId,
      })
      if (!result.ok) {
        setInviteError(result.error)
        return
      }
      setInviteNotice(`Invite sent to ${email}.`)
      setInviteEmail('')
      setInviteRoleId(NO_ROLE)
      router.refresh()
    })
  }

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

      <div className="rounded-[12px] border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-text">Invite a user</h3>
        <p className="mt-1 text-sm text-dim">
          Sends a set-password link by email. They appear below once invited.
        </p>
        {inviteError ? (
          <p role="alert" className="mt-3 text-sm text-red">
            {inviteError}
          </p>
        ) : null}
        {inviteNotice ? (
          <p role="status" className="mt-3 text-sm text-green">
            {inviteNotice}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-dim">
              Email
            </span>
            <input
              type="email"
              value={inviteEmail}
              disabled={isInviting}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="w-full rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="sm:w-52">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-dim">
              Role
            </span>
            <select
              value={inviteRoleId}
              disabled={isInviting}
              onChange={(e) => setInviteRoleId(e.target.value)}
              className="w-full rounded-[8px] border border-line bg-surface2 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-accent disabled:opacity-60"
            >
              <option value={NO_ROLE}>No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleInvite}
            disabled={isInviting}
            className="rounded-[8px] bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isInviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
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
