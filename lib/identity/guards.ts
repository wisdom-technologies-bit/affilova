import "server-only"

import { notFound, redirect } from "next/navigation"

import { can, type Action } from "./permissions"
import { safeNextPath } from "./safe-next"
import { getAuthUser, getUserRoles, type AppRole, type AuthUser } from "./session"

// The three ways server code asks "who is this, and may they do this".
//
// A page calls requireUser() or requirePermission(); a route handler calls
// apiRequirePermission() and returns the response it is given. The rules
// themselves live in lib/identity/permissions.ts; nothing here decides what a
// role may do, it only turns a decision into a redirect, a 404 or a 401/403.
//
// requireUser() and requirePermission() do not return at all when the answer is
// no: redirect() and notFound() throw, which is what stops the page body from
// rendering.

export type CurrentUser = {
  user: AuthUser
  roles: AppRole[]
}

export type DeniedBehaviour = "not-found" | "start"

/**
 * The signed-in user and their roles, or a redirect to sign in.
 *
 * nextPath is where the user was going. It is passed through safeNextPath()
 * first, so a crafted value cannot turn the sign-in redirect into an open
 * redirect, and it is encoded, so "/start/vendor" becomes
 * "/sign-in?next=%2Fstart%2Fvendor".
 */
export async function requireUser(nextPath: string): Promise<CurrentUser> {
  const user = await getAuthUser()

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(nextPath))}`)
  }

  return { user, roles: await getUserRoles(user.id) }
}

/**
 * The signed-in user, if they hold a role that grants the action.
 *
 * A signed-out visitor is sent to sign in. A signed-in user who lacks the
 * permission is either shown the not-found page, which does not reveal that the
 * page exists, or sent back to /start, which is where they choose a role.
 */
export async function requirePermission(
  action: Action,
  nextPath: string,
  onDenied: DeniedBehaviour = "not-found",
): Promise<CurrentUser> {
  const current = await requireUser(nextPath)

  if (!can(current.roles, action)) {
    if (onDenied === "start") {
      redirect("/start")
    }

    notFound()
  }

  return current
}

export type ApiPermission =
  | { ok: true; user: AuthUser; roles: AppRole[] }
  | { ok: false; response: Response }

/**
 * The route-handler form. Callers do:
 *
 *   const access = await apiRequirePermission("settings:write")
 *   if (!access.ok) return access.response
 *
 * 401 when nobody is signed in, 403 when somebody is signed in without the
 * permission. The body is a short machine-readable message, never an internal
 * reason.
 */
export async function apiRequirePermission(action: Action): Promise<ApiPermission> {
  const user = await getAuthUser()

  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return { ok: true, user, roles }
}
