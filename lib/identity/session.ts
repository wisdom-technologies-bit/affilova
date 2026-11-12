import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// Who the current request is signed in as, and what they are allowed to be.
//
// Both functions are for server code only. getAuthUser() reads the request
// cookies through the server client; getUserRoles() reads public.user_roles with
// the service role, because role rows are not writable, and only readable by
// their owner, through the client.

export type AppRole =
  | "customer"
  | "affiliate"
  | "vendor"
  | "admin"
  | "finance"
  | "support"
  | "moderator"

const APP_ROLES: readonly AppRole[] = [
  "customer",
  "affiliate",
  "vendor",
  "admin",
  "finance",
  "support",
  "moderator",
]

function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value)
}

export type AuthUser = {
  id: string
  email: string | null
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient()

  // getUser() asks the auth server to verify the token. getSession() only reads
  // whatever the cookie claims, so it is not used here.
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return null
  }

  return {
    id: data.user.id,
    email: typeof data.user.email === "string" ? data.user.email : null,
  }
}

export async function getUserRoles(userId: string): Promise<AppRole[]> {
  if (userId.trim() === "") {
    return []
  }

  const { data, error } = await getSupabaseAdminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("status", "active")

  if (error || !Array.isArray(data)) {
    return []
  }

  const roles: AppRole[] = []

  for (const row of data as unknown[]) {
    if (typeof row !== "object" || row === null) {
      continue
    }

    const role = (row as { role?: unknown }).role

    if (typeof role === "string" && isAppRole(role) && !roles.includes(role)) {
      roles.push(role)
    }
  }

  return roles
}
