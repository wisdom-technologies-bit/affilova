import { describe, expect, it, vi } from "vitest"

import { enqueueWithdrawalNotice } from "./notices"

const log = { error: vi.fn() }

describe("enqueueWithdrawalNotice", () => {
  it("queues by withdrawal id with a dedupe key per outcome", async () => {
    const enqueue = vi.fn(async () => "job")

    expect(await enqueueWithdrawalNotice(enqueue, { withdrawalId: "w-1" }, "rejected", log)).toBe(true)
    expect(enqueue).toHaveBeenCalledWith({
      type: "withdrawal_notice",
      payload: { withdrawal_id: "w-1", status: "rejected" },
      dedupeKey: "withdrawal_notice:w-1:rejected",
    })
  })

  it("ignores statuses that get no email", async () => {
    const enqueue = vi.fn(async () => "job")

    for (const status of ["requested", "approved", "processing", "cancelled", "nonsense"]) {
      expect(await enqueueWithdrawalNotice(enqueue, { withdrawalId: "w-1" }, status, log)).toBe(false)
    }

    expect(enqueue).not.toHaveBeenCalled()
  })

  it("never throws when the queue fails", async () => {
    const enqueue = vi.fn(async () => {
      throw new Error("down")
    })

    expect(await enqueueWithdrawalNotice(enqueue, { reference: "wd_x" }, "paid", log)).toBe(false)
    expect(log.error).toHaveBeenCalledWith("withdrawal_notice_enqueue_failed", { status: "paid" })
  })
})
