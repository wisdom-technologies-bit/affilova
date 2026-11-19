import { describe, expect, it } from "vitest"

// The reconciliation sweep.
//
// Paystack only sends webhooks for successful charges, so this is the second
// chance for an order that was paid while nobody was listening. What matters:
// only a verified success is posted, an abandoned order is left to expiry, and
// the run stops before its time budget is gone.

import { runReconcilePending, RECONCILE_BATCH, RECONCILE_TIME_BUDGET_MS } from "./reconcile"
import { PaystackError, type VerifiedTransaction } from "@/lib/paystack/client"

function verified(overrides: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    id: 4099260516,
    status: "success",
    reference: "afv_abc123",
    amountKobo: 40333,
    currency: "NGN",
    feesKobo: 10283,
    channel: "card",
    paidAt: "2024-08-22T09:15:02.000Z",
    gatewayResponse: "Successful",
    ...overrides,
  }
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined }

describe("runReconcilePending", () => {
  it("posts an order Paystack says was paid, using the verified values", async () => {
    const processed: Record<string, unknown>[] = []

    const summary = await runReconcilePending({
      listReferences: async () => ["afv_abc123"],
      verifyTransaction: async () => verified(),
      processPaidOrder: async (input) => {
        processed.push({ ...input })

        return { status: "processed", orderId: "order-1", number: "AFV-2026-000001" }
      },
      log: silentLog,
    })

    expect(summary).toEqual({ checked: 1, paid: 1, skipped: 0, failed: 0, stoppedEarly: false })
    expect(processed[0]).toEqual({
      reference: "afv_abc123",
      paystackTransactionId: 4099260516,
      amountKobo: 40333,
      currency: "NGN",
      feesKobo: 10283,
      channel: "card",
      paidAt: "2024-08-22T09:15:02.000Z",
    })
  })

  it("counts already_paid as paid", async () => {
    const summary = await runReconcilePending({
      listReferences: async () => ["afv_abc123"],
      verifyTransaction: async () => verified(),
      processPaidOrder: async () => ({ status: "already_paid", orderId: "order-1", number: "AFV-2026-000001" }),
      log: silentLog,
    })

    expect(summary.paid).toBe(1)
  })

  it("leaves an abandoned order alone", async () => {
    const processed: unknown[] = []

    const summary = await runReconcilePending({
      listReferences: async () => ["afv_abc123"],
      verifyTransaction: async () => verified({ status: "abandoned" }),
      processPaidOrder: async (input) => {
        processed.push(input)

        return { status: "processed", orderId: "order-1", number: "AFV-2026-000001" }
      },
      log: silentLog,
    })

    expect(summary).toEqual({ checked: 1, paid: 0, skipped: 1, failed: 0, stoppedEarly: false })
    expect(processed).toHaveLength(0)
  })

  it("keeps going when one verification fails", async () => {
    let call = 0

    const summary = await runReconcilePending({
      listReferences: async () => ["afv_one", "afv_two"],
      verifyTransaction: async () => {
        call += 1

        if (call === 1) {
          throw new PaystackError("server_error", "down", { retryable: true })
        }

        return verified({ reference: "afv_two" })
      },
      processPaidOrder: async () => ({ status: "processed", orderId: "order-2", number: "AFV-2026-000002" }),
      log: silentLog,
    })

    expect(summary).toEqual({ checked: 2, paid: 1, skipped: 0, failed: 1, stoppedEarly: false })
  })

  it("counts a mismatch as a failure and posts nothing else", async () => {
    const summary = await runReconcilePending({
      listReferences: async () => ["afv_abc123"],
      verifyTransaction: async () => verified(),
      processPaidOrder: async () => ({ status: "mismatch", orderId: "order-1", number: "AFV-2026-000001" }),
      log: silentLog,
    })

    expect(summary.failed).toBe(1)
    expect(summary.paid).toBe(0)
  })

  it("asks for the agreed batch size", async () => {
    let asked = 0

    await runReconcilePending({
      listReferences: async (limit) => {
        asked = limit

        return []
      },
      verifyTransaction: async () => verified(),
      processPaidOrder: async () => ({ status: "processed", orderId: null, number: null }),
      log: silentLog,
    })

    expect(asked).toBe(RECONCILE_BATCH)
  })

  it("stops starting work once the time budget is spent", async () => {
    let clock = 0
    const seen: string[] = []

    const summary = await runReconcilePending({
      listReferences: async () => ["afv_one", "afv_two", "afv_three"],
      verifyTransaction: async (reference) => {
        seen.push(reference)
        // Each call takes half the budget.
        clock += RECONCILE_TIME_BUDGET_MS / 2

        return verified({ reference })
      },
      processPaidOrder: async () => ({ status: "processed", orderId: null, number: null }),
      now: () => clock,
      log: silentLog,
    })

    expect(seen).toEqual(["afv_one", "afv_two"])
    expect(summary.stoppedEarly).toBe(true)
    expect(summary.checked).toBe(2)
  })

  it("returns quietly when there is nothing to check", async () => {
    const summary = await runReconcilePending({
      listReferences: async () => [],
      verifyTransaction: async () => verified(),
      processPaidOrder: async () => ({ status: "processed", orderId: null, number: null }),
      log: silentLog,
    })

    expect(summary).toEqual({ checked: 0, paid: 0, skipped: 0, failed: 0, stoppedEarly: false })
  })
})
