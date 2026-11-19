/**
 * Signed scan result callbacks.
 *
 * The body is serialised once per attempt and signed as
 * `${timestamp}.${rawBody}`, so the receiver verifies exactly the bytes it
 * parsed. Failures are retried on the schedule fixed by the contract; when every
 * attempt fails the caller is told the callback was not delivered and the app's
 * sweeper takes over.
 */

import type { FetchLike } from "#download"

import { signCallbackBody } from "#signature"

export const CALLBACK_RETRY_DELAYS_MS: readonly number[] = [
  10_000,
  30_000,
  120_000,
  600_000,
  1_800_000,
  7_200_000,
]

export const MAX_DETAIL_LENGTH = 300

export const CALLBACK_TIMEOUT_MS = 15_000

export type ScanVerdict = "clean" | "infected" | "rejected" | "needs_review" | "error"

export type CallbackPayload = {
  readonly scanId: string
  readonly fileId: string
  readonly verdict: ScanVerdict
  readonly detail: string
  readonly sha256: string | null
  readonly detectedMime: string | null
  readonly engine: "bouncer"
  readonly signatureVersion: string | null
  readonly scannedAt: string
}

export type CallbackSendResult = {
  readonly delivered: boolean
  readonly attempts: number
}

export type CallbackSender = {
  readonly send: (payload: CallbackPayload) => Promise<CallbackSendResult>
}

const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi

/**
 * Keeps a detail string inside the contract: at most 300 characters and never a
 * URL. Signature names and policy codes pass through untouched.
 */
export function sanitiseDetail(detail: string): string {
  const withoutUrls = detail.replace(URL_LIKE, " ").replace(/\s+/g, " ").trim()
  const value = withoutUrls === "" ? "unspecified" : withoutUrls

  return value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value
}

export type CallbackSenderOptions = {
  readonly callbackUrl: string
  readonly secret: string
  readonly fetch: FetchLike
  readonly sleep: (delayMs: number) => Promise<void>
  readonly now: () => number
  readonly timeoutMs?: number
}

const defaultSleep = (delayMs: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, delayMs)
  })

/**
 * Builds a sender that posts the signed callback and retries on the contract
 * schedule. Total attempts: one initial plus one per retry delay.
 */
export function createCallbackSender(options: CallbackSenderOptions): CallbackSender {
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS

  const attempt = async (rawBody: string): Promise<boolean> => {
    const timestamp = Math.floor(options.now() / 1000)
    const signature = signCallbackBody(options.secret, timestamp, rawBody)
    const controller = new AbortController()
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await options.fetch(options.callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-scanner-timestamp": String(timestamp),
          "x-scanner-signature": signature,
        },
        body: rawBody,
        redirect: "error",
        signal: controller.signal,
      })

      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    send: async (payload: CallbackPayload): Promise<CallbackSendResult> => {
      const rawBody = JSON.stringify(payload)
      let attempts = 0

      for (let index = 0; index <= CALLBACK_RETRY_DELAYS_MS.length; index += 1) {
        attempts += 1

        if (await attempt(rawBody)) {
          return { delivered: true, attempts }
        }

        const delay = CALLBACK_RETRY_DELAYS_MS[index]

        if (delay !== undefined) {
          await options.sleep(delay)
        }
      }

      return { delivered: false, attempts }
    },
  }
}

export { defaultSleep }
