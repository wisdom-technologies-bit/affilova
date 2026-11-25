import { describe, expect, it, vi } from "vitest"

import { createPayoutService, type PayoutServiceDeps } from "./service"

// The onSettled hook: called after a result recorded by the reconciler, and
// never allowed to break it.

function build(onSettled: PayoutServiceDeps["onSettled"], outcome = { status: "paid", applied: true }) {
  const warns: string[] = []
  const recorded = vi.fn(async () => outcome)
  const service = createPayoutService({
    transfers: {
      getTransferByReference: vi.fn(async () => ({
        transferCode: "TRF_1",
        reference: "wd_abcdefghijklmnopqrstuvwx",
        status: "success",
        amountKobo: 1000,
        feeKobo: 10,
      })),
    } as never,
    store: {
      listStuckWithdrawals: vi.fn(async () => [
        { id: "w-1", reference: "wd_abcdefghijklmnopqrstuvwx", transferCode: null, netKobo: BigInt(1000) },
      ]),
      recordTransferResult: recorded,
    } as never,
    log: { info: () => undefined, warn: (event: string) => void warns.push(event), error: () => undefined },
    ...(onSettled === undefined ? {} : { onSettled }),
  })

  return { service, warns, recorded }
}

describe("onSettled", () => {
  it("is called with the reference and the recorded outcome", async () => {
    const hook = vi.fn(async () => undefined)
    const { service } = build(hook)

    const summary = await service.reconcileStuck()

    expect(summary.settled).toBe(1)
    expect(hook).toHaveBeenCalledWith({ reference: "wd_abcdefghijklmnopqrstuvwx", status: "paid", applied: true })
  })

  it("does not break the reconcile when it throws", async () => {
    const { service, warns } = build(async () => {
      throw new Error("queue down")
    })

    const summary = await service.reconcileStuck()

    expect(summary.settled).toBe(1)
    expect(summary.failed).toBe(0)
    expect(warns).toContain("payout_settled_hook_failed")
  })

  it("is optional", async () => {
    const { service } = build(undefined)

    expect((await service.reconcileStuck()).settled).toBe(1)
  })
})
