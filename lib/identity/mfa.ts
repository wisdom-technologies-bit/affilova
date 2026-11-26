import "server-only"

import { redirect } from "next/navigation"

import { staffMfaEnforced } from "@/lib/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

import { safeNextPath } from "./safe-next"
import { getAuthUser, getUserRoles, type AppRole } from "./session"

// Staff two-factor sign-in, as one decision.
//
// A staff account (admin, finance, support, moderator) may only use the admin
// app with a verified second factor on the current session. That is two separate
// questions, and both must be answered:
//
//   has a verified factor?   no  -> enrol, because there is nothing to verify yet
//   is this session AAL2?    no  -> verify, because the factor is not proven here
//
// The check lives in one place and is applied in three: the admin layout, the
// shared wrapper every admin server action runs through, and the shared wrapper
// every admin route handler runs through. A page-level redirect alone would not
// be enough: a server action is an HTTP endpoint of its own, and calling it
// directly skips the page that would have redirected.
//
// The client is injected so the tests need no Supabase project: the sandbox
// cannot reach one, and a security rule should be testable without a network.

/** The roles that make an account staff. */
export const STAFF_ROLES: readonly AppRole[] = ["admin", "finance", "support", "moderator"]

export function isStaffRole(role: AppRole): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

/** True when the account holds at least one staff role. */
export function hasStaffRole(roles: readonly AppRole[]): boolean {
  return roles.some((role) => isStaffRole(role))
}

/** What the page shows when an action is refused for want of a second factor. */
export const MFA_REQUIRED_MESSAGE = "Two-factor verification required."

export interface MfaFactor {
  id: string
  status: string
  factorType: string
}

export interface Assurance {
  /** "aal1", "aal2", or null when the answer could not be read. */
  currentLevel: string | null
  /** The level this session could reach with a factor. */
  nextLevel: string | null
  /** True when the account has at least one verified factor. */
  hasVerifiedFactor: boolean
}

/**
 * The slice of the Supabase client this module uses.
 *
 * Written out rather than imported so a fake is a plain object, and so a change
 * in the SDK's return shape has to be looked at here.
 */
export interface MfaClient {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: () => Promise<{ data: unknown; error: unknown }>
      listFactors: () => Promise<{ data: unknown; error: unknown }>
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function levelOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

/** The verified factors in a listFactors() answer, and nothing else. */
export function verifiedFactors(data: unknown): MfaFactor[] {
  const record = asRecord(data)

  if (record === null) {
    return []
  }

  const all = record.all

  if (!Array.isArray(all)) {
    return []
  }

  const factors: MfaFactor[] = []

  for (const entry of all) {
    const factor = asRecord(entry)

    if (factor === null || factor.status !== "verified" || typeof factor.id !== "string") {
      continue
    }

    factors.push({
      id: factor.id,
      status: "verified",
      factorType: typeof factor.factor_type === "string" ? factor.factor_type : "unknown",
    })
  }

  return factors
}

async function defaultClient(): Promise<MfaClient> {
  return (await createSupabaseServerClient()) as unknown as MfaClient
}

/**
 * The session's assurance level and whether the account has a verified factor.
 *
 * A read that fails is not treated as "verified": the answer falls back to the
 * lowest level and "no factor", which sends a staff member to the enrol page
 * rather than letting them through.
 */
export async function getAssurance(client?: MfaClient): Promise<Assurance> {
  const resolved = client ?? (await defaultClient())

  const unknownAnswer: Assurance = { currentLevel: null, nextLevel: null, hasVerifiedFactor: false }

  let levelData: unknown
  let factorsData: unknown

  try {
    const level = await resolved.auth.mfa.getAuthenticatorAssuranceLevel()
    const factors = await resolved.auth.mfa.listFactors()

    if (level.error !== null && level.error !== undefined) {
      return unknownAnswer
    }

    if (factors.error !== null && factors.error !== undefined) {
      return unknownAnswer
    }

    levelData = level.data
    factorsData = factors.data
  } catch {
    return unknownAnswer
  }

  const levelRecord = asRecord(levelData)

  return {
    currentLevel: levelRecord === null ? null : levelOf(levelRecord.currentLevel),
    nextLevel: levelRecord === null ? null : levelOf(levelRecord.nextLevel),
    hasVerifiedFactor: verifiedFactors(factorsData).length > 0,
  }
}

/** The path a staff member is sent to, carrying where they were going. */
export function mfaRedirectPath(kind: "enroll" | "verify", nextPath: string): string {
  const next = encodeURIComponent(safeNextPath(nextPath))

  return `/two-factor/${kind}?next=${next}`
}

export type MfaDecision =
  | { ok: true }
  | { ok: false; reason: "enroll" | "verify"; redirectTo: string }

export interface MfaDeps {
  client?: MfaClient
  /** Defaults to staffMfaEnforced(). Injected so the tests can flip it. */
  enforced?: boolean
  /** Defaults to the signed-in user. */
  user?: { id: string } | null
  /** Defaults to the roles read for that user. */
  roles?: readonly AppRole[]
}

/**
 * The whole rule, as a value.
 *
 * A visitor who is not signed in, or who holds no staff role, is not this
 * module's business: the permission guard has already decided about them, and
 * this answers ok so the two rules cannot fight each other.
 */
export async function checkStaffAal2(nextPath: string, deps: MfaDeps = {}): Promise<MfaDecision> {
  const enforced = deps.enforced ?? staffMfaEnforced()

  if (!enforced) {
    return { ok: true }
  }

  const user = deps.user === undefined ? await getAuthUser() : deps.user

  if (user === null) {
    return { ok: true }
  }

  const roles = deps.roles ?? (await getUserRoles(user.id))

  if (!hasStaffRole(roles)) {
    return { ok: true }
  }

  const assurance = await getAssurance(deps.client)

  if (!assurance.hasVerifiedFactor) {
    return { ok: false, reason: "enroll", redirectTo: mfaRedirectPath("enroll", nextPath) }
  }

  if (assurance.currentLevel !== "aal2") {
    return { ok: false, reason: "verify", redirectTo: mfaRedirectPath("verify", nextPath) }
  }

  return { ok: true }
}

/**
 * The page and layout form: redirects when the session is not good enough.
 *
 * redirect() throws, so nothing below the call renders.
 */
export async function requireStaffAal2(nextPath: string, deps: MfaDeps = {}): Promise<void> {
  const decision = await checkStaffAal2(nextPath, deps)

  if (!decision.ok) {
    redirect(decision.redirectTo)
  }
}

/**
 * The action and route-handler form: a short message instead of a redirect.
 *
 * An action cannot usefully redirect a fetch() call, so it answers with the one
 * sentence the screens show. null means the session is fine.
 */
export async function staffAal2Failure(nextPath: string, deps: MfaDeps = {}): Promise<string | null> {
  const decision = await checkStaffAal2(nextPath, deps)

  return decision.ok ? null : MFA_REQUIRED_MESSAGE
}

export type Guarded<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Wrap one admin server action so the second factor cannot be skipped.
 *
 * Every admin action is called through this, so the check is in the call path
 * rather than in a page a caller might never visit:
 *
 *   export const setSomething = withStaffAal2(async (input: unknown) => { ... })
 */
export function withStaffAal2<Args extends unknown[], T>(
  nextPath: string,
  action: (...args: Args) => Promise<Guarded<T>>,
  deps: MfaDeps = {},
): (...args: Args) => Promise<Guarded<T>> {
  return async (...args: Args) => {
    const failure = await staffAal2Failure(nextPath, deps)

    if (failure !== null) {
      return { ok: false, error: failure }
    }

    return action(...args)
  }
}

/**
 * The route-handler form: 403 with the same sentence, or the response.
 *
 * A route handler that exports data must not be reachable without the second
 * factor just because it has no page around it.
 */
export async function staffAal2RouteGuard(
  nextPath: string,
  deps: MfaDeps = {},
): Promise<Response | null> {
  const failure = await staffAal2Failure(nextPath, deps)

  return failure === null ? null : Response.json({ error: failure }, { status: 403 })
}
