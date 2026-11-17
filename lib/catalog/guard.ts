import "server-only"

import { z } from "zod"

import { can, type Action } from "@/lib/identity/permissions"
import { getAuthUser, getUserRoles, type AppRole } from "@/lib/identity/session"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

import { catalogErrorMessage } from "./errors"

// The gate every catalog action goes through: who is calling, may they, and have
// they already used up their allowance.
//
// The identity is always read from the session. Nothing in an action's input can
// name the actor, and p_actor is filled from this module only.

export type GuardedActor = {
  userId: string
  roles: AppRole[]
}

export type GuardResult = { ok: true; actor: GuardedActor } | { ok: false; error: string }

export async function requireActor(action: Action): Promise<GuardResult> {
  const user = await getAuthUser()

  if (user === null) {
    return { ok: false, error: catalogErrorMessage("not_authenticated") }
  }

  const roles = await getUserRoles(user.id)

  if (!can(roles, action)) {
    return { ok: false, error: catalogErrorMessage("forbidden") }
  }

  return { ok: true, actor: { userId: user.id, roles } }
}

export type ParsedInput<T> = { ok: true; data: T } | { ok: false; error: string }

/** Validate an action's argument. A failure answers the generic sentence. */
export function parseInput<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): ParsedInput<T> {
  const result = schema.safeParse(input)

  if (!result.success) {
    return { ok: false, error: catalogErrorMessage("invalid_input") }
  }

  return { ok: true, data: result.data }
}

export const BUDGETS = {
  // Creating drafts is cheap but not free, and a runaway script should not be
  // able to fill the table.
  draft: { limit: 20, windowSeconds: 60 * 60 },
  // One upload means a reservation plus a signed URL.
  fileUpload: { limit: 60, windowSeconds: 60 * 60 },
  // One signature per image attempt.
  imageSign: { limit: 60, windowSeconds: 60 * 60 },
} as const

export type BudgetName = keyof typeof BUDGETS

/**
 * Count one attempt against a per-user allowance. onError is "allow": being
 * unable to count must not stop a vendor from finishing a product.
 */
export async function withinBudget(bucket: BudgetName, userId: string): Promise<boolean> {
  const budget = BUDGETS[bucket]

  const result = await rateLimit({
    key: rateLimitKey(["catalog", bucket, userId]),
    limit: budget.limit,
    windowSeconds: budget.windowSeconds,
    onError: "allow",
  })

  return result.allowed
}
