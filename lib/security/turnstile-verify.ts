import "server-only"

import { getServerEnv } from "@/lib/env"
import { hostMapFromEnv, normalizeHost } from "@/lib/hosts"
import { logger } from "@/lib/logger"

// Turnstile, verified on the server, for checkout only.
//
// This is deliberately separate from the Supabase auth flows: those hand the
// token to Supabase, which redeems it, and never call siteverify from this app.
// Checkout has no such hand-off, so the token is redeemed here, once.
//
// A token is single use, so a failed redemption cannot be retried with the same
// token: the buyer has to solve a new challenge.
//
// Everything fails closed. A verification service that is down must not become a
// way past the challenge, so a timeout, a network error, a missing secret or an
// unreadable answer all refuse the checkout.

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** Five seconds, as the brief requires. */
export const TURNSTILE_TIMEOUT_MS = 5_000

/** The action the checkout widget is rendered with. */
export const TURNSTILE_ACTION = "checkout"

export type TurnstileFailure =
  | "missing_token"
  | "not_configured"
  | "unavailable"
  | "rejected"
  | "wrong_action"
  | "wrong_hostname"

export type TurnstileCheck = { ok: true } | { ok: false; reason: TurnstileFailure }

export interface TurnstileVerifyDeps {
  secretKey: string
  /** Injected so tests need no network. */
  fetch: typeof fetch
  /** The host names the widget may be rendered on. */
  allowedHostnames: readonly string[]
  timeoutMs?: number
}

interface SiteverifyAnswer {
  success?: unknown
  action?: unknown
  hostname?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

export async function verifyTurnstileToken(
  token: string,
  deps: TurnstileVerifyDeps,
): Promise<TurnstileCheck> {
  if (token.trim() === "") {
    return { ok: false, reason: "missing_token" }
  }

  if (deps.secretKey.trim() === "") {
    return { ok: false, reason: "not_configured" }
  }

  const allowed = new Set(deps.allowedHostnames.map((host) => normalizeHost(host)).filter((host) => host !== ""))

  if (allowed.size === 0) {
    return { ok: false, reason: "not_configured" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TURNSTILE_TIMEOUT_MS)

  try {
    const response = await deps.fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: deps.secretKey, response: token }).toString(),
      signal: controller.signal,
      cache: "no-store",
    })

    if (!response.ok) {
      logger.error("turnstile_verify_failed", { status: response.status })

      return { ok: false, reason: "unavailable" }
    }

    const answer: SiteverifyAnswer = (await response.json()) as SiteverifyAnswer

    if (answer.success !== true) {
      // The error codes say why (timeout-or-duplicate, invalid-input-response,
      // ...). They are safe to log: they describe the token, not the person.
      logger.warn("turnstile_rejected", { reason: "not_successful" })

      return { ok: false, reason: "rejected" }
    }

    const action = readString(answer.action)

    if (action !== TURNSTILE_ACTION) {
      logger.warn("turnstile_rejected", { reason: "action_mismatch" })

      return { ok: false, reason: "wrong_action" }
    }

    const hostname = normalizeHost(readString(answer.hostname))

    if (hostname === "" || !allowed.has(hostname)) {
      logger.warn("turnstile_rejected", { reason: "hostname_mismatch" })

      return { ok: false, reason: "wrong_hostname" }
    }

    return { ok: true }
  } catch {
    // A timeout, a refused connection or a body that is not JSON: all refuse.
    logger.error("turnstile_verify_failed", { reason: "network" })

    return { ok: false, reason: "unavailable" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The host names a token may have been solved on: every configured app host, and
 * localhost while developing.
 */
export function checkoutAllowedHostnames(): string[] {
  const hosts = hostMapFromEnv()
  const allowed = Object.values(hosts).filter((host): host is string => typeof host === "string")

  if (process.env.NEXT_PUBLIC_APP_ENV === "development") {
    allowed.push("localhost", "127.0.0.1")
  }

  return allowed
}

/** Verify a checkout token with the configured secret and hosts. */
export async function verifyCheckoutTurnstile(token: string): Promise<TurnstileCheck> {
  let secretKey = ""

  try {
    secretKey = getServerEnv().TURNSTILE_SECRET_KEY ?? ""
  } catch {
    // A missing server environment is a configuration failure, not a pass.
    return { ok: false, reason: "not_configured" }
  }

  return verifyTurnstileToken(token, {
    secretKey,
    fetch: globalThis.fetch,
    allowedHostnames: checkoutAllowedHostnames(),
  })
}
