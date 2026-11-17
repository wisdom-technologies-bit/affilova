import "server-only"

import { cache } from "react"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The real account data the app shells show: the name and email from the
// profile, and every role the account holds with the status it is stored with.
//
// The service role client is used because role rows are not readable by their
// owner through the client (see lib/identity/session.ts, which does the same for
// the active roles). Nothing here decides access: the guards did that already.

export type RoleStatus = "active" | "revoked"

export type AccountRole = {
  role: string
  status: RoleStatus
}

export type AccountSummary = {
  userId: string
  displayName: string | null
  email: string | null
  roles: AccountRole[]
}

function trimmedText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()

  return trimmed === "" ? null : trimmed
}

function roleStatus(value: unknown): RoleStatus | null {
  if (value === "active" || value === "revoked") {
    return value
  }

  return null
}

function readRoles(rows: unknown): AccountRole[] {
  if (!Array.isArray(rows)) {
    return []
  }

  const roles: AccountRole[] = []

  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) {
      continue
    }

    const record = row as { role?: unknown; status?: unknown }
    const role = trimmedText(record.role)
    const status = roleStatus(record.status)

    if (role === null || status === null) {
      continue
    }

    roles.push({ role, status })
  }

  return roles
}

async function readAccountSummary(userId: string, email: string | null): Promise<AccountSummary> {
  if (userId.trim() === "") {
    return { userId, displayName: null, email, roles: [] }
  }

  const client = getSupabaseAdminClient()

  const [profileResult, rolesResult] = await Promise.all([
    client.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    client.from("user_roles").select("role, status").eq("user_id", userId).order("role"),
  ])

  const profileRow: unknown = profileResult.error ? null : profileResult.data
  const displayName =
    typeof profileRow === "object" && profileRow !== null
      ? trimmedText((profileRow as { display_name?: unknown }).display_name)
      : null

  return {
    userId,
    displayName,
    email,
    roles: rolesResult.error ? [] : readRoles(rolesResult.data),
  }
}

/**
 * The account summary, memoised for the length of a request so a layout and the
 * page inside it share one set of queries.
 */
export const getAccountSummary = cache(readAccountSummary)
