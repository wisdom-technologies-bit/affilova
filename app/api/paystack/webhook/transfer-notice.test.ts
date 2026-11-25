import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { handlePaystackWebhook, type WebhookDeps } from "./route"

// The withdrawal notice is queued only when a transfer result was applied now.

const SECRET_KEY = "sk_test_0123456789abcdef0123456789abcdef"
const REFERENCE = "wd_abcdefghijklmnopqrstuvwx"

function setup(result: { status: string; applied: boolean }, enqueueFails = false) {
  const enqueueJob = vi.fn(async (input: unknown) => {
    if (enqueueFails) {
      throw new Error("queue down")
    }

    return "job"
  })
  const errors: string[] = []

  const deps = {
    secretKey: SECRET_KEY,
    enforceIps: false,
    verifyTransaction: vi.fn(),
    insertEvent: vi.fn(async () => ({ id: "e", duplicate: false })),
    finishEvent: vi.fn(async () => undefined),
    enqueueJob,
    recordTransferResult: vi.fn(async () => result),
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: (event: string) => void errors.push(event),
    },
  } as unknown as WebhookDeps

  return { deps, enqueueJob, errors }
}

function post(event: string, deps: WebhookDeps): Promise<Response> {
  const text = JSON.stringify({
    event,
    data: {
      transfer_code: "TRF_1",
      reference: REFERENCE,
      fee_charged: 1000,
      recipient: { details: { account_number: "0123456789" } },
    },
  })
  const signature = createHmac("sha512", SECRET_KEY).update(Buffer.from(text, "utf8")).digest("hex")

  return handlePaystackWebhook(
    new Request("http://localhost/api/paystack/webhook", {
      method: "POST",
      headers: { "x-paystack-signature": signature },
      body: text,
    }),
    deps,
  )
}

describe("withdrawal notice from the transfer webhook", () => {
  it.each([
    ["transfer.success", "paid"],
    ["transfer.failed", "failed"],
    ["transfer.reversed", "reversed"],
  ])("queues one notice for %s", async (event, status) => {
    const { deps, enqueueJob } = setup({ status, applied: true })

    const response = await post(event, deps)

    expect(response.status).toBe(200)
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledWith({
      type: "withdrawal_notice",
      payload: { reference: REFERENCE, status },
      dedupeKey: `withdrawal_notice:${REFERENCE}:${status}`,
    })
  })

  it("queues nothing when the result was already applied", async () => {
    const { deps, enqueueJob } = setup({ status: "paid", applied: false })

    await post("transfer.success", deps)

    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it("never puts an account number in the job", async () => {
    const { deps, enqueueJob } = setup({ status: "paid", applied: true })

    await post("transfer.success", deps)

    expect(JSON.stringify(enqueueJob.mock.calls)).not.toContain("0123456789")
  })

  it("still answers 200 when the queue is down, and logs it", async () => {
    const { deps, errors } = setup({ status: "paid", applied: true }, true)

    const response = await post("transfer.success", deps)

    expect(response.status).toBe(200)
    expect(errors).toContain("withdrawal_notice_enqueue_failed")
  })
})
