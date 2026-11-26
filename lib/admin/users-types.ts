import { catalogErrorMessage } from "@/lib/catalog/errors"

// The vocabulary of the admin Users screens.
//
// These live outside lib/admin/users-actions.ts because a "use server" module
// may only export async functions: a constant or a synchronous helper in one is
// a build error, and rightly so.

export const STAFF_ROLES = ["admin", "finance", "support", "moderator"] as const
export const ACCOUNT_STATUSES = ["active", "suspended", "deletion_pending"] as const
export const VERIFICATION_LEVELS = ["basic", "verified", "pro"] as const

export type StaffRole = (typeof STAFF_ROLES)[number]
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number]

export interface AdminUserRow {
  id: string
  email: string | null
  displayName: string | null
  status: AccountStatus
  verificationLevel: VerificationLevel
  roles: string[]
  createdAt: string
}

export interface AdminUserList {
  rows: AdminUserRow[]
  total: number
}

export interface AdminUserRole {
  role: string
  status: string
  createdAt: string
}

export interface AdminUserDetail {
  id: string
  email: string | null
  displayName: string | null
  status: AccountStatus
  verificationLevel: VerificationLevel
  createdAt: string
  roles: AdminUserRole[]
}

export type Fail = { ok: false; error: string }

/** The sentence a failed action shows. Kept here so both screens agree. */
export function actionError(result: Fail): string {
  return result.error === "" ? catalogErrorMessage("forbidden") : result.error
}
