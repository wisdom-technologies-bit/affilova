import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { handlePaystackWebhook, type WebhookDeps } from "./route"

// transfer.success, transfer.failed and transfer.reversed, driven through the
// real handler with a faked database. Nothing here talks to Paystack.

const SECRET_KEY = "sk_test_0123456789abcdef0123456789abcdef"

interface Recorded {
  statuses: Array<{ status: string; error: string | null }>
  results: Array<{
    reference: string
    event: string
    transferCode: string | null
    reason: string | null
    feeKobo: bigint | null
  }>
  logs: Array<{ level: string; event: string; fields: unknown }>
}

function makeDeps(
  options: {
    recordTransferResult?: WebhookDeps["recordTransferResult"]
    insertError?: boolean
    duplicate?: boolean
    /** Leave the payout writer out entirely, as a deployment without it would. */
    omitRecorder?: boolean
  } = {},
): { deps: WebhookDeps; recorded: Recorded } {
  const recorded: Recorded = { statuses: [], results: [], logs: [] }

  const noop = async () => ({ status: "processed" as const })

  const log = {
    info: (event: string, fields?: Record<string, unknown>) =>
      void recorded.logs.push({ level: "info", event, fields }),
    warn: (event: string, fields?: Record<string, unknown>) =>
      void recorded.logs.push({ level: "warn", event, fields }),
    error: (event: string, fields?: Record<string, unknown>) =>
      void recorded.logs.push({ level: "error", event, fields }),
  }

  const recordTransferResult: WebhookDeps["recordTransferResult"] =
    options.recordTransferResult ??
    (async (call) => {
      recorded.results.push(call)

      return { status: "paid", applied: true }
    })

  const deps: WebhookDeps = {
    secretKey: SECRET_KEY,
    enforceIps: false,
    verifyTransaction: vi.fn(async () => {
      throw new Error("not used")
    }),
    insertEvent: vi.fn(async () => {
      if (options.insertError === true) {
        throw new Error("down")
      }

      return { id: "event-1", duplicate: options.duplicate === true }
    }),
    finishEvent: vi.fn(async (_id: string, status: string, error: string | null) => {
      recorded.statuses.push({ status, error })
    }),
    processPaidOrder: vi.fn(async () => ({ status: "processed" as const, orderId: "o" })),
    findOpenRefund: vi.fn(async () => null),
    processRefund: vi.fn(async () => ({ status: "processed" as const, orderId: "o" })),
    enqueueJob: vi.fn(async () => "job"),
    markRefundFailed: vi.fn(async () => undefined),
    getOrderByReference: vi.fn(async () => null),
    openDispute: vi.fn(async () => undefined),
    recordDisputeProviderOutcome: vi.fn(async () => undefined),
    ...(options.omitRecorder === true ? {} : { recordTransferResult }),
    log,
  } as unknown as WebhookDeps

  return { deps, recorded }
}

function post(body: unknown, deps: WebhookDeps, secret = SECRET_KEY): Promise<Response> {
  const text = JSON.stringify(body)
  const signature = createHmac("sha512", secret).update(Buffer.from(text, "utf8")).digest("hex")

  return handlePaystackWebhook(
    new Request("http://localhost/api/paystack/webhook", {
      method: "POST",
      headers: { "x-paystack-signature": signature, "content-type": "application/json" },
      body: text,
    }),
    deps,
  )
}

const REFERENCE = "wd_abcdefghijklmnopqrstuvwx"

function transferBody(event: string, overrides: Record<string, unknown> = {}) {
  return {
    event,
    data: {
      id: 424242,
      transfer_code: "TRF_abc123",
      reference: REFERENCE,
      amount: 500000,
      fee_charged: 1000,
      status: "success",
      currency: "NGN",
      // The real payload carries a full account number here. It must never be
      // read, logged or stored.
      recipient: {
        recipient_code: "RCP_secret_code",
        details: { account_number: "0123456789", account_name: "ADAEZE OKONKWO" },
      },
      ...overrides,
    },
  }
}

describe("transfer events", () => {
  it("settles a success with the reference and the fee", async () => {
    const { deps, recorded } = makeDeps()

    const response = await post(transferBody("transfer.success"), deps)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(recorded.results).toEqual([
      {
        reference: REFERENCE,
        event: "success",
        transferCode: "TRF_abc123",
        reason: null,
        feeKobo: BigInt(1000),
      },
    ])
    expect(recorded.statuses).toEqual([{ status: "processed", error: null }])
  })

  it("settles a failure with a safe reason", async () => {
    const { deps, recorded } = makeDeps()

    await post(transferBody("transfer.failed", { status: "failed" }), deps)

    expect(recorded.results[0]).toMatchObject({ event: "failed", reason: "paystack_failed" })
  })

  it("settles a reversal", async () => {
    const { deps, recorded } = makeDeps()

    await post(transferBody("transfer.reversed", { status: "reversed" }), deps)

    expect(recorded.results[0]).toMatchObject({ event: "reversed" })
  })

  it("falls back to the fee bands when the body has no fee", async () => {
    const { deps, recorded } = makeDeps()

    await post(transferBody("transfer.success", { fee_charged: 0 }), deps)

    expect(recorded.results[0]?.feeKobo).toBeNull()
  })

  it("answers a repeated delivery as a duplicate and settles once", async () => {
    const { deps, recorded } = makeDeps()
    const body = transferBody("transfer.success")

    await post(body, deps)
    const second = await post(body, makeDeps({ duplicate: true }).deps)

    expect(second.status).toBe(200)
    expect(recorded.results).toHaveLength(1)
  })

  it("records an unknown reference as ignored", async () => {
    const { deps, recorded } = makeDeps({
      recordTransferResult: async () => ({ status: "not_found", applied: false }),
    })

    const response = await post(transferBody("transfer.success"), deps)

    expect(response.status).toBe(200)
    expect(recorded.statuses).toEqual([{ status: "ignored", error: "withdrawal_not_found" }])
  })

  it("ignores a transfer code that does not match our row", async () => {
    const { deps, recorded } = makeDeps({
      recordTransferResult: async () => ({ status: "mismatch", applied: false }),
    })

    await post(transferBody("transfer.success", { transfer_code: "TRF_other" }), deps)

    expect(recorded.statuses).toEqual([{ status: "ignored", error: "transfer_mismatch" }])
    expect(recorded.logs.some((entry) => entry.level === "error")).toBe(true)
  })

  it("marks a body with no reference as failed", async () => {
    const { deps, recorded } = makeDeps()

    await post({ event: "transfer.success", data: { amount: 500000 } }, deps)

    expect(recorded.statuses).toEqual([{ status: "failed", error: "missing_reference" }])
    expect(recorded.results).toHaveLength(0)
  })

  it("asks Paystack to retry when the database is down", async () => {
    const { deps } = makeDeps({
      recordTransferResult: async () => {
        throw new Error("down")
      },
    })

    const response = await post(transferBody("transfer.success"), deps)

    expect(response.status).toBe(500)
  })

  it("logs an error instead of crashing when the handler is not wired", async () => {
    const { deps, recorded } = makeDeps({ omitRecorder: true })

    const response = await post(transferBody("transfer.success"), deps)

    expect(response.status).toBe(200)
    expect(recorded.statuses).toEqual([{ status: "ignored", error: "unhandled_event" }])
  })

  it("never puts the account number or the recipient code in a log", async () => {
    const { deps, recorded } = makeDeps()

    await post(transferBody("transfer.success"), deps)

    const text = JSON.stringify(recorded.logs) + JSON.stringify(recorded.statuses)

    expect(text).not.toContain("0123456789")
    expect(text).not.toContain("RCP_secret_code")
    expect(text).not.toContain(SECRET_KEY)
  })

  it("still refuses a bad signature", async () => {
    const { deps, recorded } = makeDeps()

    const response = await post(transferBody("transfer.success"), deps, "sk_test_wrong")

    expect(response.status).toBe(401)
    expect(recorded.results).toHaveLength(0)
  })
})
