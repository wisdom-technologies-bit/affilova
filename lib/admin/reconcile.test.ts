import { beforeEach, describe, expect, it, vi } from "vitest"

const spies = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }))

vi.mock("@/lib/logger", () => ({ logger: { error: spies.error, warn: spies.warn, info: vi.fn() } }))
vi.mock("./db", () => ({ recordReconciliationRun: vi.fn() }))

import { RECONCILIATION_ALERT_KOBO, runDailyReconciliation } from "./reconcile"

describe("runDailyReconciliation", () => {
  const error = spies.error
  const warn = spies.warn

  beforeEach(() => {
    error.mockClear()
    warn.mockClear()
  })

  it("stores a matched run without shouting", async () => {
    const outcome = await runDailyReconciliation({
      balanceKobo: async () => BigInt(1_000_000),
      record: async () => ({ diffKobo: BigInt(0) }),
    })

    expect(outcome).toEqual({
      status: "recorded",
      ledgerKobo: BigInt(1_000_000),
      providerKobo: BigInt(1_000_000),
      diffKobo: BigInt(0),
      alerted: false,
    })
    expect(error).not.toHaveBeenCalled()
  })

  it("logs at error level when the difference is over the threshold, and still succeeds", async () => {
    const outcome = await runDailyReconciliation({
      balanceKobo: async () => BigInt(1_000_000),
      record: async () => ({ diffKobo: RECONCILIATION_ALERT_KOBO + BigInt(1) }),
    })

    expect(outcome.status).toBe("recorded")
    expect(outcome.status === "recorded" && outcome.alerted).toBe(true)
    expect(error).toHaveBeenCalledWith("reconciliation_difference", expect.objectContaining({ diff_kobo: "100001" }))
  })

  it("counts a negative difference by its size", async () => {
    const outcome = await runDailyReconciliation({
      balanceKobo: async () => BigInt(1_000_000),
      record: async () => ({ diffKobo: -(RECONCILIATION_ALERT_KOBO + BigInt(5)) }),
    })

    expect(outcome.status === "recorded" && outcome.alerted).toBe(true)
    expect(outcome.status === "recorded" && outcome.ledgerKobo).toBe(BigInt(1_000_000) - RECONCILIATION_ALERT_KOBO - BigInt(5))
  })

  it("does not shout for a difference inside the threshold", async () => {
    const outcome = await runDailyReconciliation({
      balanceKobo: async () => BigInt(1_000_000),
      record: async () => ({ diffKobo: RECONCILIATION_ALERT_KOBO }),
    })

    expect(outcome.status === "recorded" && outcome.alerted).toBe(false)
    expect(error).not.toHaveBeenCalled()
  })

  it("skips the run, with a warning, when Paystack cannot answer", async () => {
    const outcome = await runDailyReconciliation({
      balanceKobo: async () => {
        throw new Error("paystack_down")
      },
      record: async () => {
        throw new Error("must not be called")
      },
    })

    expect(outcome).toEqual({ status: "unavailable", reason: "Error" })
    expect(warn).toHaveBeenCalledWith("reconciliation_balance_unavailable", { reason: "Error" })
    expect(error).not.toHaveBeenCalled()
  })
})
