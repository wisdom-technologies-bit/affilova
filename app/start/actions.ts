"use server"

import { createHash } from "node:crypto"

import { headers } from "next/headers"
import type { ZodError } from "zod"

import {
  affiliateSchema,
  vendorSchema,
  type AffiliateInput,
  type VendorInput,
} from "@/lib/identity/onboarding-schemas"
import { POLICY_VERSION } from "@/lib/identity/policies"
import { getAuthUser } from "@/lib/identity/session"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

// The two onboarding server actions.
//
// Both follow the same three rules:
//   * the form is validated here with the shared schema, and the errors come
//     back one per field so the form can put each message next to its input;
//   * nothing is written from the client. The row, the role, the acceptance and
//     the audit entry are created by the SECURITY DEFINER function in the
//     migration, which the service role is the only role allowed to call;
//   * a database message never reaches the browser. A taken handle becomes a
//     field error, and everything else becomes one fixed sentence.

const MESSAGES = {
  signedOut: "Please sign in again.",
  invalid: "Check the highlighted fields.",
  generic: "Something went wrong. Please try again.",
  slugTaken: "That store address is taken.",
  usernameTaken: "That username is taken.",
} as const

/** Field name to message. An empty object when the problem is not field-specific. */
export type OnboardingFieldErrors = { [field: string]: string }

export type OnboardingResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string; fieldErrors: OnboardingFieldErrors }

type RpcError = { code?: string | null } | null

type RpcResult = { data: unknown; error: RpcError }

function toFieldErrors(error: ZodError): OnboardingFieldErrors {
  const fieldErrors: OnboardingFieldErrors = {}

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "form"

    // The first message per field is the one shown; later ones are noise.
    if (fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message
    }
  }

  return fieldErrors
}

/**
 * SHA-256 of the first address in x-forwarded-for, or null when there is none.
 * The raw address is never stored and never leaves this function.
 */
async function hashedClientIp(): Promise<string | null> {
  const headerList = await headers()
  const forwarded = headerList.get("x-forwarded-for")

  if (forwarded === null) {
    return null
  }

  const first = forwarded.split(",")[0]?.trim() ?? ""

  if (first === "") {
    return null
  }

  return createHash("sha256").update(first).digest("hex")
}

function readCreated(data: unknown): boolean {
  if (typeof data !== "object" || data === null) {
    return false
  }

  return (data as { created?: unknown }).created === true
}

function isDuplicate(error: RpcError): boolean {
  return error?.code === "23505"
}

/**
 * Creates the vendor row for the signed-in user and grants the vendor role.
 *
 * Safe to call twice: the function returns created:false the second time and
 * changes nothing. A taken store address comes back as an error on the slug
 * field.
 */
export async function becomeVendorAction(input: VendorInput): Promise<OnboardingResult> {
  const parsed = vendorSchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const user = await getAuthUser()

  if (!user) {
    return { ok: false, error: MESSAGES.signedOut, fieldErrors: {} }
  }

  const phone = parsed.data.phone === undefined ? "" : parsed.data.phone

  const result: RpcResult = await getSupabaseAdminClient().rpc("become_vendor", {
    p_user: user.id,
    p_business_name: parsed.data.businessName,
    p_slug: parsed.data.slug,
    p_support_email: parsed.data.supportEmail,
    p_phone: phone === "" ? null : phone,
    p_country: parsed.data.country,
    p_terms_version: POLICY_VERSION,
    p_ip_hash: await hashedClientIp(),
  })

  if (result.error !== null) {
    if (isDuplicate(result.error)) {
      return {
        ok: false,
        error: MESSAGES.invalid,
        fieldErrors: { slug: MESSAGES.slugTaken },
      }
    }

    return { ok: false, error: MESSAGES.generic, fieldErrors: {} }
  }

  return { ok: true, created: readCreated(result.data) }
}

/**
 * Creates the affiliate row for the signed-in user and grants the affiliate
 * role. Same contract as becomeVendorAction(), with the username as the field
 * that can collide.
 */
export async function becomeAffiliateAction(input: AffiliateInput): Promise<OnboardingResult> {
  const parsed = affiliateSchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const user = await getAuthUser()

  if (!user) {
    return { ok: false, error: MESSAGES.signedOut, fieldErrors: {} }
  }

  const result: RpcResult = await getSupabaseAdminClient().rpc("become_affiliate", {
    p_user: user.id,
    p_username: parsed.data.username,
    p_promotion_channels: parsed.data.promotionChannels,
    p_country: parsed.data.country,
    p_terms_version: POLICY_VERSION,
    p_ip_hash: await hashedClientIp(),
  })

  if (result.error !== null) {
    if (isDuplicate(result.error)) {
      return {
        ok: false,
        error: MESSAGES.invalid,
        fieldErrors: { username: MESSAGES.usernameTaken },
      }
    }

    return { ok: false, error: MESSAGES.generic, fieldErrors: {} }
  }

  return { ok: true, created: readCreated(result.data) }
}
