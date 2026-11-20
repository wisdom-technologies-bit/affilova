import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { createAccessToken, verifyAccessToken } from "./access-token"
import {
  DOWNLOAD_MESSAGES,
  DOWNLOAD_URL_SECONDS,
  downloadFile,
  hashDownloadIp,
  type ClaimedDownload,
  type DownloadDeps,
} from "./download"

const SECRET = "0123456789abcdef0123456789abcdef"
const ORDER = "3f1b9c62-8d1e-4f27-9a53-1c0f5b2e7d41"
const EMAIL = "buyer@example.com"
const ENTITLEMENT = "8b2f4d10-6c3a-4e59-9f01-2d7c8b4a6e35"
const IP = "102.89.44.10"

const token = createAccessToken({ orderId: ORDER, email: EMAIL }, { secret: SECRET })

function deps(overrides: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    verifyToken: (value) => verifyAccessToken(value, { secret: SECRET }),
    readOrder: async () => ({ buyerEmail: EMAIL, status: "paid" }),
    claimDownload: async () => ({
      ok: true,
      storageKey: "products/6f1a/files/8b2f/playbook.pdf",
      filename: "playbook.pdf",
    }),
    presign: async () => "https://files.example.com/signed?token=secret",
    logInfo: vi.fn(),
    ...overrides,
  }
}

describe("downloading one file", () => {
  it("claims with the buyer email from the order, a hashed IP, and presigns for five minutes", async () => {
    const claimDownload = vi.fn(
      async (input: Parameters<DownloadDeps["claimDownload"]>[0]): Promise<ClaimedDownload> => {
        void input

        return {
          ok: true,
          storageKey: "products/6f1a/files/8b2f/playbook.pdf",
          filename: "playbook.pdf",
        }
      },
    )
    const presign = vi.fn(async () => "https://files.example.com/signed?token=secret")

    const outcome = await downloadFile(
      { token, entitlementId: ENTITLEMENT, ip: IP, userId: null },
      deps({ claimDownload, presign }),
    )

    expect(outcome).toEqual({ ok: true, url: "https://files.example.com/signed?token=secret" })
    expect(claimDownload).toHaveBeenCalledWith({
      entitlementId: ENTITLEMENT,
      buyerUserId: null,
      buyerEmail: EMAIL,
      ipHash: createHash("sha256").update(IP).digest("hex"),
    })
    expect(presign).toHaveBeenCalledWith({
      key: "products/6f1a/files/8b2f/playbook.pdf",
      filename: "playbook.pdf",
      expiresInSeconds: DOWNLOAD_URL_SECONDS,
    })
  })

  it("passes the signed-in user id through, so an account download is attributed", async () => {
    const claimDownload = vi.fn(
      async (input: Parameters<DownloadDeps["claimDownload"]>[0]): Promise<ClaimedDownload> => {
        void input

        return { ok: true, storageKey: "k", filename: "f.pdf" }
      },
    )

    await downloadFile(
      { token, entitlementId: ENTITLEMENT, ip: IP, userId: "user-1" },
      deps({ claimDownload }),
    )

    expect(claimDownload).toHaveBeenCalledWith(expect.objectContaining({ buyerUserId: "user-1" }))
  })

  it("hashes the IP and never stores it raw", async () => {
    const claimDownload = vi.fn(
      async (input: Parameters<DownloadDeps["claimDownload"]>[0]): Promise<ClaimedDownload> => {
        void input

        return { ok: true, storageKey: "k", filename: "f.pdf" }
      },
    )

    await downloadFile({ token, entitlementId: ENTITLEMENT, ip: IP }, deps({ claimDownload }))

    const call = claimDownload.mock.calls[0]?.[0]

    expect(call?.ipHash).toBe(createHash("sha256").update(IP).digest("hex"))
    expect(JSON.stringify(call)).not.toContain(IP)
  })

  it("maps every refusal the database can give", async () => {
    const cases: Array<[string, string, string]> = [
      ["forbidden", "forbidden", DOWNLOAD_MESSAGES.forbidden],
      ["revoked", "revoked", DOWNLOAD_MESSAGES.revoked],
      ["expired", "expired", DOWNLOAD_MESSAGES.expired],
      ["download_limit", "download_limit", DOWNLOAD_MESSAGES.download_limit],
      ["file_not_clean", "file_not_clean", DOWNLOAD_MESSAGES.file_not_clean],
      ["order_not_paid", "not_paid", DOWNLOAD_MESSAGES.order_not_paid],
      ["something_else", "unavailable", DOWNLOAD_MESSAGES.unavailable],
    ]

    for (const [databaseCode, code, message] of cases) {
      const outcome = await downloadFile(
        { token, entitlementId: ENTITLEMENT, ip: IP },
        deps({ claimDownload: async () => ({ ok: false, code: databaseCode }) }),
      )

      expect(outcome).toEqual({ ok: false, code, error: message })
    }
  })

  it("refuses a bad token before reading anything", async () => {
    const readOrder = vi.fn()

    const outcome = await downloadFile(
      { token: "tampered.token", entitlementId: ENTITLEMENT, ip: IP },
      deps({ readOrder }),
    )

    expect(outcome).toEqual({
      ok: false,
      code: "invalid_token",
      error: DOWNLOAD_MESSAGES.invalid_token,
    })
    expect(readOrder).not.toHaveBeenCalled()
  })

  it("refuses when the order is not paid", async () => {
    const claimDownload = vi.fn()

    const outcome = await downloadFile(
      { token, entitlementId: ENTITLEMENT, ip: IP },
      deps({ readOrder: async () => ({ buyerEmail: EMAIL, status: "refunded" }), claimDownload }),
    )

    expect(outcome).toEqual({ ok: false, code: "not_paid", error: DOWNLOAD_MESSAGES.order_not_paid })
    expect(claimDownload).not.toHaveBeenCalled()
  })

  it("answers a sentence when the presign fails", async () => {
    const outcome = await downloadFile(
      { token, entitlementId: ENTITLEMENT, ip: IP },
      deps({
        presign: async () => {
          throw new Error("R2 down")
        },
      }),
    )

    expect(outcome).toEqual({ ok: false, code: "unavailable", error: DOWNLOAD_MESSAGES.unavailable })
  })

  it("never logs the URL, the key or the filename", async () => {
    const logInfo = vi.fn()

    await downloadFile({ token, entitlementId: ENTITLEMENT, ip: IP }, deps({ logInfo }))

    const logged = JSON.stringify(logInfo.mock.calls)

    expect(logInfo).toHaveBeenCalledWith("download_link_issued")
    expect(logged).not.toContain("signed")
    expect(logged).not.toContain("playbook.pdf")
    expect(logged).not.toContain("products/6f1a")
    expect(logged).not.toContain(IP)
  })

  it("treats an unattributable address as no address", () => {
    expect(hashDownloadIp("")).toBeNull()
    expect(hashDownloadIp("unknown")).toBeNull()
    expect(hashDownloadIp(IP)).toMatch(/^[0-9a-f]{64}$/)
  })
})
