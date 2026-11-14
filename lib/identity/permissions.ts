// What a role may do, as a pure function of the roles a user holds.
//
// Nothing here imports Next.js or Supabase: this file is the whole rulebook, so
// it can be read and unit tested on its own. The roles themselves come from
// lib/identity/session.ts, which is the single place the database values are
// parsed.
//
// Roles never imply each other. Holding "admin" does not give a user "finance":
// every action that finance may take lists finance explicitly.

import type { AppRole } from "./session"

export type Action =
  | "area:account"
  | "area:affiliate"
  | "area:merchant"
  | "area:admin"
  | "products:review"
  | "tickets:read"
  | "payouts:approve"
  | "vat:manage"
  | "settings:read"
  | "settings:write"
  | "users:suspend"
  | "roles:grant"

export const ACTIONS: readonly Action[] = [
  "area:account",
  "area:affiliate",
  "area:merchant",
  "area:admin",
  "products:review",
  "tickets:read",
  "payouts:approve",
  "vat:manage",
  "settings:read",
  "settings:write",
  "users:suspend",
  "roles:grant",
]

// area:account is listed for every role because every signed-in person has the
// customer role, and "customer" is the only role a brand-new account holds.
const PERMISSIONS: Record<Action, readonly AppRole[]> = {
  "area:account": [
    "customer",
    "affiliate",
    "vendor",
    "admin",
    "finance",
    "support",
    "moderator",
  ],
  "area:affiliate": ["affiliate"],
  "area:merchant": ["vendor"],
  "area:admin": ["admin", "finance", "support", "moderator"],
  "products:review": ["admin", "moderator"],
  "tickets:read": ["admin", "support"],
  "payouts:approve": ["admin", "finance"],
  "vat:manage": ["admin", "finance"],
  "settings:read": ["admin", "finance", "support", "moderator"],
  "settings:write": ["admin", "finance"],
  "users:suspend": ["admin"],
  "roles:grant": ["admin"],
}

/**
 * True when at least one of the roles a user holds grants the action.
 *
 * An action that is not in the matrix is denied. The signature is typed, so a
 * typo is a compile error; the runtime check is what makes an unexpected value
 * arriving from stored data or a future caller fail closed instead of throwing.
 */
export function can(roles: readonly AppRole[], action: Action): boolean {
  if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, action)) {
    return false
  }

  const allowed = PERMISSIONS[action]

  return roles.some((role) => allowed.includes(role))
}
