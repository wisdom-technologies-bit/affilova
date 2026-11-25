import { createHmac, randomInt } from "node:crypto"

import { getStepUpSecret } from "@/lib/env"

// The step-up code: a 6 digit number emailed to the account owner before a bank
// change or a withdrawal.
//
// The number comes from node:crypto (never Math.random), is always six
// characters with leading zeros kept, and is stored only as an HMAC keyed by
// STEP_UP_SECRET and bound to the user and the purpose, so a hash copied from
// one user's row cannot be replayed for another user or another purpose.

export const STEP_UP_PURPOSES = ["bank_change", "withdrawal"] as const

export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number]

/** How long an emailed code stays valid. */
export const STEP_UP_EXPIRY_SECONDS = 10 * 60

export const STEP_UP_CODE_LENGTH = 6

export const STEP_UP_CODE_PATTERN = /^[0-9]{6}$/

/** Six digits from a cryptographically secure source, leading zeros kept. */
export function generateCode(random: (max: number) => number = randomInt): string {
  return random(1_000_000).toString().padStart(STEP_UP_CODE_LENGTH, "0")
}

export interface HashCodeInput {
  userId: string
  purpose: StepUpPurpose
  code: string
  /** Injected so a test needs no environment; production reads STEP_UP_SECRET. */
  secret?: string
}

/** Lowercase hex HMAC-SHA256 over purpose, user and code. */
export function hashCode(input: HashCodeInput): string {
  const secret = input.secret ?? getStepUpSecret()

  return createHmac("sha256", secret)
    .update(`${input.purpose}:${input.userId}:${input.code}`)
    .digest("hex")
}

/** A user types the code with spaces or dashes; only the digits count. */
export function normaliseCode(raw: string): string {
  return raw.replace(/[\s-]/g, "")
}

export function isWellFormedCode(code: string): boolean {
  return STEP_UP_CODE_PATTERN.test(code)
}
