import "server-only"

import { createHash } from "node:crypto"

import { logger } from "@/lib/logger"
import { getR2Storage } from "@/lib/storage/r2"

import { verifyAccessToken, type AccessTokenResult } from "./access-token"

// Handing out one file.
//
// The token is verified here again, not trusted from the page: the page is a
// render, this is the action that actually produces a URL. The buyer's email
// comes from the order, never from the request, so a caller cannot name someone
// else's address. The database function decides whether the download is allowed
// (revoked, expired, limit reached, file not clean, order not paid), and this
// module only turns its answer into a sentence.
//
// A presigned URL is a credential. It is returned to the caller and never
// logged, not even at debug level, and the log line carries no key either.

/** Five minutes, as the brief requires. */
export const DOWNLOAD_URL_SECONDS = 300

export type DownloadFailure =
  | "invalid_token"
  | "not_paid"
  | "forbidden"
  | "revoked"
  | "expired"
  | "download_limit"
  | "file_not_clean"
  | "unavailable"

const DATABASE_CODES: readonly string[] = [
  "forbidden",
  "revoked",
  "expired",
  "download_limit",
  "file_not_clean",
  "order_not_paid",
] as const

/** The sentence a buyer reads for each refusal. No codes, no jargon. */
export const DOWNLOAD_MESSAGES: Readonly<Record<DownloadFailure | "order_not_paid", string>> = {
  invalid_token: "This download link is not valid. Ask for a new link.",
  not_paid: "This purchase is not active, so the files cannot be downloaded.",
  forbidden: "This link was not issued for this order, so the file cannot be downloaded.",
  revoked: "This file was withdrawn from the order. Contact us through our contact page.",
  expired: "This download has expired. Ask for a new link.",
  download_limit: "You have used every download allowed for this file.",
  file_not_clean: "This file is held back while it is checked. Try again later.",
  order_not_paid: "This purchase is not active, so the files cannot be downloaded.",
  unavailable: "We could not prepare the download. Please try again in a moment.",
}

export type ClaimedDownload =
  | { ok: true; storageKey: string; filename: string }
  | { ok: false; code: string }

export interface DownloadDeps {
  verifyToken: (token: string) => AccessTokenResult
  readOrder: (orderId: string) => Promise<{ buyerEmail: string; status: string } | null>
  claimDownload: (input: {
    entitlementId: string
    buyerUserId: string | null
    buyerEmail: string
    ipHash: string | null
  }) => Promise<ClaimedDownload>
  presign: (input: { key: string; filename: string; expiresInSeconds: number }) => Promise<string>
  logInfo: (event: string, fields?: Record<string, unknown>) => void
}

export type DownloadOutcome =
  | { ok: true; url: string }
  | { ok: false; code: DownloadFailure; error: string }

/** SHA-256 of the caller's address, in hex. The raw address is not kept. */
export function hashDownloadIp(ip: string): string | null {
  const value = typeof ip === "string" ? ip.trim() : ""

  if (value === "" || value === "unknown") {
    return null
  }

  return createHash("sha256").update(value).digest("hex")
}

function isFailure(code: string): code is DownloadFailure {
  return (DATABASE_CODES as readonly string[]).includes(code)
}

/** The refusal codes that are not a DownloadFailure of their own. */
function normalise(code: string): DownloadFailure {
  return code === "order_not_paid" ? "not_paid" : isFailure(code) ? code : "unavailable"
}

function refuse(code: DownloadFailure): DownloadOutcome {
  const key = code === "not_paid" ? "order_not_paid" : code

  return { ok: false, code, error: DOWNLOAD_MESSAGES[key] }
}

export interface DownloadInput {
  token: string
  entitlementId: string
  ip: string
  userId?: string | null
}

/**
 * Verify, claim and presign one file.
 *
 * Every refusal is a value with a sentence, so the button can show it inline.
 */
export async function downloadFile(
  input: DownloadInput,
  deps: DownloadDeps,
): Promise<DownloadOutcome> {
  const verified = deps.verifyToken(typeof input.token === "string" ? input.token : "")

  if (!verified.ok) {
    return refuse("invalid_token")
  }

  const entitlementId = typeof input.entitlementId === "string" ? input.entitlementId.trim() : ""

  if (entitlementId === "") {
    return refuse("forbidden")
  }

  let order: { buyerEmail: string; status: string } | null

  try {
    order = await deps.readOrder(verified.claims.orderId)
  } catch {
    return refuse("unavailable")
  }

  if (order === null || order.status !== "paid") {
    return refuse("not_paid")
  }

  const claimed = await deps.claimDownload({
    entitlementId,
    buyerUserId: input.userId === undefined ? null : input.userId,
    buyerEmail: order.buyerEmail,
    ipHash: hashDownloadIp(input.ip),
  })

  if (!claimed.ok) {
    const code = normalise(claimed.code)

    deps.logInfo("download_refused", { code })

    return refuse(code)
  }

  let url: string

  try {
    url = await deps.presign({
      key: claimed.storageKey,
      filename: claimed.filename,
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    })
  } catch {
    deps.logInfo("download_presign_failed")

    return refuse("unavailable")
  }

  // Deliberately no key, no filename and no URL in this line.
  deps.logInfo("download_link_issued")

  return { ok: true, url }
}

/** The production dependencies: the database function, R2, and the logger. */
export function defaultDownloadDeps(): DownloadDeps {
  return {
    verifyToken: verifyAccessToken,
    readOrder: async (orderId) => {
      const { getSupabaseAdminClient } = await import("@/lib/supabase/admin")

      const { data, error } = await getSupabaseAdminClient()
        .from("orders")
        .select("buyer_email,status")
        .eq("id", orderId)
        .maybeSingle()

      if (error !== null || data === null) {
        return null
      }

      const record = data as Record<string, unknown>

      return typeof record.buyer_email === "string" && typeof record.status === "string"
        ? { buyerEmail: record.buyer_email, status: record.status }
        : null
    },
    claimDownload: async (claim) => {
      const { getSupabaseAdminClient } = await import("@/lib/supabase/admin")

      const { data, error } = await getSupabaseAdminClient().rpc("claim_download", {
        p_entitlement: claim.entitlementId,
        p_buyer_user: claim.buyerUserId,
        p_buyer_email: claim.buyerEmail,
        p_ip_hash: claim.ipHash,
      })

      if (error !== null) {
        return { ok: false, code: typeof error.message === "string" ? error.message : "unavailable" }
      }

      const row = Array.isArray(data) ? data[0] : data
      const record = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null

      if (
        record === null ||
        typeof record.storage_key !== "string" ||
        typeof record.filename !== "string"
      ) {
        return { ok: false, code: "unavailable" }
      }

      return { ok: true, storageKey: record.storage_key, filename: record.filename }
    },
    presign: (input) => getR2Storage().presignGetUrl(input),
    logInfo: (event, fields) => logger.info(event, fields),
  }
}
