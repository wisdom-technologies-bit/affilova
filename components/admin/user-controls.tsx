"use client"

import { useActionState } from "react"

import {
  submitGrantRole,
  submitRevokeRole,
  submitUserStatus,
  submitVerificationLevel,
} from "@/lib/admin/users-actions"
import { ACCOUNT_STATUSES, STAFF_ROLES, VERIFICATION_LEVELS } from "@/lib/admin/users-types"

// The controls on one account.
//
// Three changes, each its own form and its own sentence: roles, status and
// verification level. Every form posts and comes back with either nothing (the
// change went through and the page re-rendered) or one sentence in an aria-live
// region. No control is optimistic: the row it changes is read from the database
// again, so what is on screen is what is stored.

const SELECT =
  "mt-1.5 block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
const LABEL = "block text-sm font-medium text-foreground"
const BUTTON =
  "inline-flex min-h-11 items-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
const QUIET_BUTTON =
  "inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
const PANEL = "rounded-lg border border-border p-5"

function Message({ error }: { error: string | null }) {
  return (
    <p aria-live="polite" className="mt-3 min-h-5 text-sm text-destructive">
      {error ?? ""}
    </p>
  )
}

export interface UserControlsProps {
  userId: string
  roles: { role: string; status: string }[]
  status: string
  verificationLevel: string
}

export function UserControls({ userId, roles, status, verificationLevel }: UserControlsProps) {
  const [roleError, grantAction, granting] = useActionState(submitGrantRole, null)
  const [revokeError, revokeAction, revoking] = useActionState(submitRevokeRole, null)
  const [statusError, statusAction, savingStatus] = useActionState(submitUserStatus, null)
  const [levelError, levelAction, savingLevel] = useActionState(submitVerificationLevel, null)

  const active = new Set(roles.filter((entry) => entry.status === "active").map((entry) => entry.role))
  const grantable = STAFF_ROLES.filter((role) => !active.has(role))

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={PANEL} aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="text-base font-semibold text-foreground">
          Staff roles
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only staff roles are managed here. Customer, affiliate and vendor access belongs to onboarding.
        </p>

        <ul className="mt-4 space-y-2">
          {roles.length === 0 ? (
            <li className="text-sm text-muted-foreground">No roles.</li>
          ) : (
            roles.map((entry) => (
              <li key={entry.role} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">
                  {entry.role}
                  <span className="ml-2 text-xs text-muted-foreground">{entry.status}</span>
                </span>
                {entry.status === "active" && STAFF_ROLES.includes(entry.role as (typeof STAFF_ROLES)[number]) ? (
                  <form action={revokeAction}>
                    <input type="hidden" name="userId" value={userId} />
                    <input type="hidden" name="role" value={entry.role} />
                    <button type="submit" className={QUIET_BUTTON} disabled={revoking}>
                      Revoke
                    </button>
                  </form>
                ) : null}
              </li>
            ))
          )}
        </ul>

        {grantable.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Every staff role is already held.</p>
        ) : (
          <form action={grantAction} className="mt-4">
            <input type="hidden" name="userId" value={userId} />
            <label htmlFor="grant-role" className={LABEL}>
              Grant a role
            </label>
            <select id="grant-role" name="role" className={SELECT} defaultValue={grantable[0]}>
              {grantable.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button type="submit" className={`${BUTTON} mt-3`} disabled={granting}>
              Grant
            </button>
          </form>
        )}

        <Message error={roleError ?? revokeError} />
      </section>

      <div className="grid gap-5">
        <section className={PANEL} aria-labelledby="status-heading">
          <h2 id="status-heading" className="text-base font-semibold text-foreground">
            Account status
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Suspending closes the account to sign-in. The last active admin cannot be suspended.
          </p>

          <form action={statusAction} className="mt-4">
            <input type="hidden" name="userId" value={userId} />
            <label htmlFor="account-status" className={LABEL}>
              Status
            </label>
            <select id="account-status" name="status" className={SELECT} defaultValue={status}>
              {ACCOUNT_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button type="submit" className={`${BUTTON} mt-3`} disabled={savingStatus}>
              Save status
            </button>
          </form>

          <Message error={statusError} />
        </section>

        <section className={PANEL} aria-labelledby="verification-heading">
          <h2 id="verification-heading" className="text-base font-semibold text-foreground">
            Verification level
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified vendors can be paid. Raising a level is a decision with money behind it.
          </p>

          <form action={levelAction} className="mt-4">
            <input type="hidden" name="userId" value={userId} />
            <label htmlFor="verification-level" className={LABEL}>
              Level
            </label>
            <select id="verification-level" name="level" className={SELECT} defaultValue={verificationLevel}>
              {VERIFICATION_LEVELS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <button type="submit" className={`${BUTTON} mt-3`} disabled={savingLevel}>
              Save level
            </button>
          </form>

          <Message error={levelError} />
        </section>
      </div>
    </div>
  )
}
