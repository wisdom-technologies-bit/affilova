import { describe, expect, it, vi } from "vitest"

import { PaystackError } from "@/lib/paystack/client"

import {
  PAYOUT_TRANSFER_REASON,
  createPayoutService,
  payoutReference,
  type PayoutLog,
  type PayoutServiceDeps,
  type PayoutStorePort,
  type PayoutTransfersPort,
} from "./service"

// The service is driven entirely through fakes: no database, no network.

const USER = "11111111-1111-4111-8111-111111111111"
const REFERENCE = "wd_abcdefghijklmnopqrstuvwx"

function makeLog(): PayoutLog & { calls: Array<{ level: string; event: string }> } {
  const calls: Array<{ level: string; event: string }> = []

  return {
    calls,
    info: (event) => void calls.push({ level: "info", event }),
    warn: (event) => void calls.push({ level: "warn", event }),
    error: (event) => void calls.push({ level: "error", event }),
  }
}

function preview(availableKobo: bigint) {
  return {
    allowed: true,
    reasons: [] as string[],
    grossKobo: availableKobo,
    feeKobo: BigInt(0),
    netKobo: availableKobo,
    availableKobo,
    nextPayoutDay: "2026-11-24",
    needsApproval: false,
  }
}

function makeTransfers(overrides: Partial<PayoutTransfersPort> = {}): PayoutTransfersPort {
  return {
    resolveAccount: vi.fn(async () => ({
      accountName: "ADAEZE OKONKWO",
      accountNumber: "0123456789",
    })),
    createRecipient: vi.fn(async () => ({ recipientCode: "RCP_1", name: "ADAEZE OKONKWO" })),
    getBalance: vi.fn(async () => [{ currency: "NGN", balanceKobo: 100_000_000 }]),
    initiateTransfer: vi.fn(async () => ({
      transferCode: "TRF_1",
      transferId: BigInt(9),
      reference: REFERENCE,
      status: "success",
      amountKobo: 500_000,
      feeKobo: 1000,
      alreadySubmitted: false,
    })),
    getTransferByReference: vi.fn(async () => ({
      transferCode: "TRF_1",
      reference: REFERENCE,
      status: "success",
      amountKobo: 500_000,
      feeKobo: 1000,
    })),
    ...overrides,
  }
}

function makeStore(overrides: Partial<PayoutStorePort> = {}): PayoutStorePort {
  return {
    setPayoutAccount: vi.fn(async () => "account-id"),
    withdrawalPreview: vi.fn(async () => preview(BigInt(500_000))),
    requestWithdrawal: vi.fn(async () => ({
      withdrawalId: "withdrawal-id",
      status: "approved",
      needsApproval: false,
    })),
    claimWithdrawalsForTransfer: vi.fn(async () => []),
    releaseClaimedWithdrawals: vi.fn(async (ids: readonly string[]) => ids.length),
    markTransferSubmitted: vi.fn(async () => undefined),
    recordTransferResult: vi.fn(async () => ({ status: "paid", applied: true })),
    listAutoPayoutCandidates: vi.fn(async () => []),
    listStuckWithdrawals: vi.fn(async () => []),
    transferFee: vi.fn(async () => BigInt(1000)),
    ...overrides,
  }
}

function makeService(overrides: {
  transfers?: Partial<PayoutTransfersPort>
  store?: Partial<PayoutStorePort>
  now?: () => number
  log?: PayoutLog
}) {
  const deps: PayoutServiceDeps = {
    transfers: makeTransfers(overrides.transfers),
    store: makeStore(overrides.store),
    log: overrides.log ?? makeLog(),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    newReference: () => REFERENCE,
  }

  return { service: createPayoutService(deps), deps }
}

describe("payoutReference", () => {
  it("is wd_ plus 24 lowercase alphanumerics", () => {
    const reference = payoutReference(() => 7)

    expect(reference).toMatch(/^wd_[a-z0-9]{24}$/)
    expect(reference).toHaveLength(27)
  })

  it("is inside Paystack's 16 to 50 character rule", () => {
    const reference = payoutReference()

    expect(reference.length).toBeGreaterThanOrEqual(16)
    expect(reference.length).toBeLessThanOrEqual(50)
  })
})

describe("prepareAccount", () => {
  it("resolves, matches, creates a recipient and stores only the last four digits", async () => {
    const { service, deps } = makeService({})

    const result = await service.prepareAccount({
      userId: USER,
      bankCode: "058",
      bankName: "GTBank",
      accountNumber: "0123456789",
      profileName: "Adaeze Okonkwo",
    })

    expect(result).toEqual({ status: "ok", accountId: "account-id", resolvedName: "ADAEZE OKONKWO" })
    expect(deps.transfers.createRecipient).toHaveBeenCalledTimes(1)
    expect(deps.store.setPayoutAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountLast4: "6789", nameMatch: true, recipientCode: "RCP_1" }),
    )

    const stored = JSON.stringify(vi.mocked(deps.store.setPayoutAccount).mock.calls)
    expect(stored).not.toContain("0123456789")
  })

  it("creates nothing when the name does not match", async () => {
    const { service, deps } = makeService({
      transfers: {
        resolveAccount: vi.fn(async () => ({
          accountName: "CHINWE BELLO",
          accountNumber: "0123456789",
        })),
      },
    })

    const result = await service.prepareAccount({
      userId: USER,
      bankCode: "058",
      bankName: "GTBank",
      accountNumber: "0123456789",
      profileName: "Adaeze Okonkwo",
    })

    expect(result).toEqual({ status: "name_mismatch", resolvedName: "CHINWE BELLO" })
    expect(deps.transfers.createRecipient).not.toHaveBeenCalled()
    expect(deps.store.setPayoutAccount).not.toHaveBeenCalled()
  })
})

describe("previewWithdrawal", () => {
  it("passes the amount through as bigint kobo", async () => {
    const { service, deps } = makeService({})

    const result = await service.previewWithdrawal(USER, BigInt(500_000))

    expect(result.availableKobo).toBe(BigInt(500_000))
    expect(deps.store.withdrawalPreview).toHaveBeenCalledWith(USER, BigInt(500_000))
  })
})

describe("requestManualWithdrawal", () => {
  it("uses the manual kind and a fresh reference", async () => {
    const { service, deps } = makeService({})

    const result = await service.requestManualWithdrawal({ userId: USER, amountKobo: BigInt(500_000) })

    expect(result.reference).toBe(REFERENCE)
    expect(deps.store.requestWithdrawal).toHaveBeenCalledWith({
      userId: USER,
      amountKobo: BigInt(500_000),
      kind: "manual",
      reference: REFERENCE,
    })
  })
})

describe("runAutoPayouts", () => {
  it("requests the whole available balance for each candidate", async () => {
    const { service, deps } = makeService({
      store: {
        listAutoPayoutCandidates: vi.fn(async () => [USER]),
        withdrawalPreview: vi.fn(async () => preview(BigInt(1_250_000))),
      },
    })

    const summary = await service.runAutoPayouts()

    expect(summary).toEqual({
      candidates: 1,
      requested: 1,
      skipped: 0,
      failed: 0,
      stoppedEarly: false,
    })
    expect(deps.store.requestWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, amountKobo: BigInt(1_250_000), kind: "auto" }),
    )
  })

  it("keeps going when one user fails", async () => {
    const other = "22222222-2222-4222-8222-222222222222"
    const request = vi
      .fn()
      .mockRejectedValueOnce(new PaystackError("bad_request", "no", { retryable: false }))
      .mockResolvedValueOnce({ withdrawalId: "w", status: "approved", needsApproval: false })

    const { service } = makeService({
      store: {
        listAutoPayoutCandidates: vi.fn(async () => [USER, other]),
        requestWithdrawal: request,
      },
    })

    const summary = await service.runAutoPayouts()

    expect(summary.requested).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it("skips a user with nothing available", async () => {
    const { service } = makeService({
      store: {
        listAutoPayoutCandidates: vi.fn(async () => [USER]),
        withdrawalPreview: vi.fn(async () => preview(BigInt(0))),
      },
    })

    const summary = await service.runAutoPayouts()

    expect(summary.skipped).toBe(1)
    expect(summary.requested).toBe(0)
  })

  it("stops before the time budget and says so", async () => {
    let clock = 0

    const { service, deps } = makeService({
      now: () => clock,
      store: {
        listAutoPayoutCandidates: vi.fn(async () => [USER, USER, USER, USER]),
        withdrawalPreview: vi.fn(async () => {
          clock += 7_000

          return preview(BigInt(500_000))
        }),
      },
    })

    const summary = await service.runAutoPayouts({ budgetMs: 18_000 })

    expect(summary.stoppedEarly).toBe(true)
    expect(summary.requested).toBeLessThan(4)
    expect(deps.store.requestWithdrawal).toHaveBeenCalledTimes(summary.requested)
  })
})

describe("processApprovedWithdrawals", () => {
  const claimed = [
    { id: "w1", reference: REFERENCE, netKobo: BigInt(500_000), recipientCode: "RCP_1", userId: USER },
  ]

  it("sends each claimed withdrawal and records the transfer code", async () => {
    const { service, deps } = makeService({
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.submitted).toBe(1)
    expect(deps.transfers.initiateTransfer).toHaveBeenCalledWith({
      amountKobo: 500_000,
      recipientCode: "RCP_1",
      reference: REFERENCE,
      reason: PAYOUT_TRANSFER_REASON,
    })
    expect(deps.store.markTransferSubmitted).toHaveBeenCalledWith("w1", "TRF_1", BigInt(9))
  })

  it("does nothing when nothing is claimed", async () => {
    const { service, deps } = makeService({})

    const summary = await service.processApprovedWithdrawals()

    expect(summary.claimed).toBe(0)
    expect(deps.transfers.getBalance).not.toHaveBeenCalled()
  })

  it("puts the batch back when the Paystack balance cannot cover it", async () => {
    const log = makeLog()
    const { service, deps } = makeService({
      log,
      transfers: {
        getBalance: vi.fn(async () => [{ currency: "NGN", balanceKobo: 100_000 }]),
      },
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.lowBalance).toBe(true)
    expect(summary.released).toBe(1)
    expect(deps.store.releaseClaimedWithdrawals).toHaveBeenCalledWith(["w1"])
    expect(deps.transfers.initiateTransfer).not.toHaveBeenCalled()
    expect(log.calls.map((call) => call.event)).toContain("payout_balance_low")
    expect(log.calls.find((call) => call.event === "payout_balance_low")?.level).toBe("error")
  })

  it("counts the transfer fee in what the balance must cover", async () => {
    const { service } = makeService({
      transfers: { getBalance: vi.fn(async () => [{ currency: "NGN", balanceKobo: 500_500 }]) },
      store: {
        claimWithdrawalsForTransfer: vi.fn(async () => claimed),
        transferFee: vi.fn(async () => BigInt(1000)),
      },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.lowBalance).toBe(true)
    expect(summary.released).toBe(1)
  })

  it("records a definite rejection as failed with a safe reason", async () => {
    const { service, deps } = makeService({
      transfers: {
        initiateTransfer: vi.fn(async () => {
          throw new PaystackError("bad_request", "recipient is invalid", { retryable: false })
        }),
      },
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.failed).toBe(1)
    expect(deps.store.recordTransferResult).toHaveBeenCalledWith({
      reference: REFERENCE,
      event: "failed",
      transferCode: null,
      reason: "paystack_bad_request",
      feeKobo: null,
    })
  })

  it("leaves an unknown outcome processing for the reconciler", async () => {
    const { service, deps } = makeService({
      transfers: {
        initiateTransfer: vi.fn(async () => {
          throw new PaystackError("timeout", "no answer", { retryable: true })
        }),
      },
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.failed).toBe(0)
    expect(summary.submitted).toBe(0)
    expect(deps.store.recordTransferResult).not.toHaveBeenCalled()
  })

  it("does not send again when Paystack says the reference exists", async () => {
    const { service, deps } = makeService({
      transfers: {
        initiateTransfer: vi.fn(async () => ({
          transferCode: "",
          transferId: null,
          reference: REFERENCE,
          status: "pending",
          amountKobo: 500_000,
          feeKobo: null,
          alreadySubmitted: true,
        })),
      },
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.submitted).toBe(0)
    expect(deps.store.markTransferSubmitted).not.toHaveBeenCalled()
  })

  it("counts a transfer waiting for an OTP and leaves it processing", async () => {
    const { service } = makeService({
      transfers: {
        initiateTransfer: vi.fn(async () => ({
          transferCode: "TRF_otp",
          transferId: BigInt(3),
          reference: REFERENCE,
          status: "otp",
          amountKobo: 500_000,
          feeKobo: null,
          alreadySubmitted: false,
        })),
      },
      store: { claimWithdrawalsForTransfer: vi.fn(async () => claimed) },
    })

    const summary = await service.processApprovedWithdrawals()

    expect(summary.otpPending).toBe(1)
    expect(summary.submitted).toBe(0)
  })

  it("releases the unsent remainder when the time budget runs out", async () => {
    let clock = 0
    const two = [
      claimed[0] as (typeof claimed)[number],
      { ...(claimed[0] as (typeof claimed)[number]), id: "w2", reference: "wd_bbbbbbbbbbbbbbbbbbbbbbbb" },
    ]

    const { service, deps } = makeService({
      now: () => clock,
      store: { claimWithdrawalsForTransfer: vi.fn(async () => two) },
      transfers: {
        initiateTransfer: vi.fn(async () => {
          clock += 20_000

          return {
            transferCode: "TRF_1",
            transferId: BigInt(9),
            reference: REFERENCE,
            status: "success",
            amountKobo: 500_000,
            feeKobo: 1000,
            alreadySubmitted: false,
          }
        }),
      },
    })

    const summary = await service.processApprovedWithdrawals({ budgetMs: 15_000 })

    expect(summary.stoppedEarly).toBe(true)
    expect(summary.submitted).toBe(1)
    expect(deps.store.releaseClaimedWithdrawals).toHaveBeenCalledWith(["w2"])
  })
})

describe("reconcileStuck", () => {
  const stuck = [
    { id: "w1", reference: REFERENCE, transferCode: "TRF_1", netKobo: BigInt(500_000) },
  ]

  it("settles a success from the verify call", async () => {
    const { service, deps } = makeService({
      store: { listStuckWithdrawals: vi.fn(async () => stuck) },
    })

    const summary = await service.reconcileStuck()

    expect(summary.settled).toBe(1)
    expect(deps.store.recordTransferResult).toHaveBeenCalledWith({
      reference: REFERENCE,
      event: "success",
      transferCode: "TRF_1",
      reason: null,
      feeKobo: BigInt(1000),
    })
  })

  it("settles a failure and a reversal", async () => {
    for (const [status, event] of [
      ["failed", "failed"],
      ["reversed", "reversed"],
    ] as const) {
      const { service, deps } = makeService({
        transfers: {
          getTransferByReference: vi.fn(async () => ({
            transferCode: "TRF_1",
            reference: REFERENCE,
            status,
            amountKobo: 500_000,
            feeKobo: null,
          })),
        },
        store: { listStuckWithdrawals: vi.fn(async () => stuck) },
      })

      await service.reconcileStuck()

      expect(deps.store.recordTransferResult).toHaveBeenCalledWith(
        expect.objectContaining({ event, reason: `paystack_${status}` }),
      )
    }
  })

  it("leaves a pending transfer alone", async () => {
    const { service, deps } = makeService({
      transfers: {
        getTransferByReference: vi.fn(async () => ({
          transferCode: "TRF_1",
          reference: REFERENCE,
          status: "pending",
          amountKobo: 500_000,
          feeKobo: null,
        })),
      },
      store: { listStuckWithdrawals: vi.fn(async () => stuck) },
    })

    const summary = await service.reconcileStuck()

    expect(summary.stillPending).toBe(1)
    expect(deps.store.recordTransferResult).not.toHaveBeenCalled()
  })

  it("counts a failed lookup without throwing", async () => {
    const { service } = makeService({
      transfers: {
        getTransferByReference: vi.fn(async () => {
          throw new PaystackError("not_found", "gone", { retryable: false })
        }),
      },
      store: { listStuckWithdrawals: vi.fn(async () => stuck) },
    })

    const summary = await service.reconcileStuck()

    expect(summary.failed).toBe(1)
  })

  it("asks for withdrawals older than the interval it is given", async () => {
    const list = vi.fn(async () => [])
    const { service } = makeService({ store: { listStuckWithdrawals: list } })

    await service.reconcileStuck({ olderThan: "30 minutes" })

    expect(list).toHaveBeenCalledWith("30 minutes")
  })
})
