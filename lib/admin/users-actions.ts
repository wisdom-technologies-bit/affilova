"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { GENERIC_ERROR } from "@/lib/catalog/errors"
import { staffAal2Failure } from "@/lib/identity/mfa"
import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { logger } from "@/lib/logger"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import {
  ACCOUNT_STATUSES,
  STAFF_ROLES,
  VERIFICATION_LEVELS,
  actionError,
  type AccountStatus,
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserRole,
  type AdminUserRow,
  type Fail,
  type VerificationLevel,
} from "./users-types"

// The admin Users actions.
//
// They are thin on purpose: the rules that matter (staff roles only, an active
// admin as the actor, the last active admin is never removed) live in the
// database functions in migration 20261125000200_admin_users.sql, where a screen
// cannot get around them. What happens here is the four checks the app owns, in
// this order: signed in, holds the permission, has completed the second factor,
// input is well formed.
//
// The actor handed to SQL is always the authenticated user's id, never a value
// from the form.

type Ok<T> = { ok: true; data: T }
type Result<T> = Ok<T> | Fail

type Guard = { ok: true; userId: string; roles: AppRole[] } | Fail

const NOT_SIGNED_IN = "Sign in again to continue."
const FORBIDDEN = "You do not have access to that."
const NO_SUCH_USER = "That account no longer exists."

async function guard(permission: Action): Promise<Guard> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: NOT_SIGNED_IN }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, permission)) {
    return { ok: false, error: FORBIDDEN }
  }

  const mfa = await staffAal2Failure("/admin")

  if (mfa !== null) {
    return { ok: false, error: mfa }
  }

  return { ok: true, userId: user.id, roles }
}

/**
 * A sentence for the caller, from the SQLSTATE the database raised.
 *
 * The messages in the migration are written for a person, but they are raised as
 * exceptions; a Supabase error also carries internal detail, so nothing from it
 * is passed through. The four states the screens can hit each get one sentence.
 */
function mutationError(name: string, error: { code?: unknown; message?: unknown } | null): string {
  const code = typeof error?.code === "string" ? error.code : ""

  if (code === "check_violation") {
    return "That would leave no active admin. Give someone else the admin role first."
  }

  if (code === "insufficient_privilege") {
    return FORBIDDEN
  }

  if (code === "no_data_found") {
    return NO_SUCH_USER
  }

  if (code === "invalid_parameter_value") {
    return "That change is not allowed."
  }

  logger.error("admin_users_rpc_failed", {
    name,
    code: code === "" ? "unknown" : code,
  })

  return GENERIC_ERROR
}

function shape(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function rolesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function rowOf(value: unknown): AdminUserRow | null {
  const raw = shape(value)
  const id = text(raw.id)

  if (id === null) {
    return null
  }

  return {
    id,
    email: text(raw.email),
    displayName: text(raw.display_name),
    status: (text(raw.status) ?? "active") as AccountStatus,
    verificationLevel: (text(raw.verification_level) ?? "basic") as VerificationLevel,
    roles: rolesOf(raw.roles),
    createdAt: text(raw.created_at) ?? "",
  }
}

const LIST_INPUT = z.object({
  search: z.string().trim().max(120).default(""),
  status: z.enum(ACCOUNT_STATUSES).nullable().default(null),
  role: z.enum(STAFF_ROLES).nullable().default(null),
  page: z.number().int().min(0).max(10_000).default(0),
})

export type UserListInput = z.input<typeof LIST_INPUT>

const PAGE_SIZE = 25

export async function listUsersAction(input: UserListInput): Promise<Result<AdminUserList>> {
  const access = await guard("users:suspend")

  if (!access.ok) {
    return access
  }

  const parsed = LIST_INPUT.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "That search is not something we can run." }
  }

  const { data, error } = await getSupabaseAdminClient().rpc("admin_list_users", {
    p_search: parsed.data.search === "" ? null : parsed.data.search,
    p_status: parsed.data.status,
    p_role: parsed.data.role,
    p_limit: PAGE_SIZE,
    p_offset: parsed.data.page * PAGE_SIZE,
  })

  if (error !== null) {
    logger.error("admin_list_users_failed", { code: typeof error.code === "string" ? error.code : "unknown" })

    return { ok: false, error: GENERIC_ERROR }
  }

  const rows: AdminUserRow[] = []
  let total = 0

  for (const entry of Array.isArray(data) ? data : []) {
    const row = rowOf(entry)

    if (row === null) {
      continue
    }

    rows.push(row)

    const count = shape(entry).total_count
    const asNumber = typeof count === "number" ? count : Number(count)

    if (Number.isFinite(asNumber)) {
      total = asNumber
    }
  }

  return { ok: true, data: { rows, total } }
}

export async function getUserAction(userId: string): Promise<Result<AdminUserDetail | null>> {
  const access = await guard("users:suspend")

  if (!access.ok) {
    return access
  }

  const { data, error } = await getSupabaseAdminClient().rpc("admin_get_user", { p_user_id: userId })

  if (error !== null) {
    logger.error("admin_get_user_failed", { code: typeof error.code === "string" ? error.code : "unknown" })

    return { ok: false, error: GENERIC_ERROR }
  }

  const raw = shape(data)
  const id = text(raw.id)

  if (id === null) {
    return { ok: true, data: null }
  }

  const roles: AdminUserRole[] = []

  for (const entry of Array.isArray(raw.roles) ? raw.roles : []) {
    const role = shape(entry)
    const name = text(role.role)

    if (name === null) {
      continue
    }

    roles.push({
      role: name,
      status: text(role.status) ?? "",
      createdAt: text(role.created_at) ?? "",
    })
  }

  return {
    ok: true,
    data: {
      id,
      email: text(raw.email),
      displayName: text(raw.display_name),
      status: (text(raw.status) ?? "active") as AccountStatus,
      verificationLevel: (text(raw.verification_level) ?? "basic") as VerificationLevel,
      createdAt: text(raw.created_at) ?? "",
      roles,
    },
  }
}

const ROLE_INPUT = z.object({
  userId: z.string().uuid(),
  role: z.enum(STAFF_ROLES),
})

async function mutate(
  name: string,
  args: Record<string, unknown>,
): Promise<Result<null>> {
  const { error } = await getSupabaseAdminClient().rpc(name, args)

  if (error !== null) {
    return { ok: false, error: mutationError(name, error) }
  }

  revalidatePath("/hosts/admin/users")
  revalidatePath(`/hosts/admin/users/${String(args.p_user_id ?? "")}`)

  return { ok: true, data: null }
}

export async function grantStaffRoleAction(input: unknown): Promise<Result<null>> {
  const access = await guard("roles:grant")

  if (!access.ok) {
    return access
  }

  const parsed = ROLE_INPUT.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Choose a staff role." }
  }

  return mutate("admin_grant_staff_role", {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_actor: access.userId,
  })
}

export async function revokeStaffRoleAction(input: unknown): Promise<Result<null>> {
  const access = await guard("roles:grant")

  if (!access.ok) {
    return access
  }

  const parsed = ROLE_INPUT.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Choose a staff role." }
  }

  return mutate("admin_revoke_staff_role", {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_actor: access.userId,
  })
}

const STATUS_INPUT = z.object({
  userId: z.string().uuid(),
  status: z.enum(ACCOUNT_STATUSES),
})

export async function setUserStatusAction(input: unknown): Promise<Result<null>> {
  const access = await guard("users:suspend")

  if (!access.ok) {
    return access
  }

  const parsed = STATUS_INPUT.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Choose a status." }
  }

  return mutate("admin_set_user_status", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_actor: access.userId,
  })
}

const LEVEL_INPUT = z.object({
  userId: z.string().uuid(),
  level: z.enum(VERIFICATION_LEVELS),
})

export async function setVerificationLevelAction(input: unknown): Promise<Result<null>> {
  const access = await guard("users:suspend")

  if (!access.ok) {
    return access
  }

  const parsed = LEVEL_INPUT.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: "Choose a verification level." }
  }

  return mutate("admin_set_verification_level", {
    p_user_id: parsed.data.userId,
    p_level: parsed.data.level,
    p_actor: access.userId,
  })
}

// ---------------------------------------------------------------------------
// Form entry points
//
// The screens post plain forms, so each control gets a wrapper that reads the
// FormData and returns the sentence to show, or null when the change went
// through. They are separate from the object-taking actions above so a caller
// with typed input is not forced through a form.
// ---------------------------------------------------------------------------

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim()
}

export async function submitGrantRole(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await grantStaffRoleAction({ userId: field(formData, "userId"), role: field(formData, "role") })

  return result.ok ? null : actionError(result)
}

export async function submitRevokeRole(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await revokeStaffRoleAction({ userId: field(formData, "userId"), role: field(formData, "role") })

  return result.ok ? null : actionError(result)
}

export async function submitUserStatus(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await setUserStatusAction({ userId: field(formData, "userId"), status: field(formData, "status") })

  return result.ok ? null : actionError(result)
}

export async function submitVerificationLevel(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const result = await setVerificationLevelAction({ userId: field(formData, "userId"), level: field(formData, "level") })

  return result.ok ? null : actionError(result)
}
