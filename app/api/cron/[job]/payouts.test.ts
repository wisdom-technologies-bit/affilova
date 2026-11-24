import { beforeEach, describe, expect, it, vi } from "vitest"

import * as routeModule from "./route"

const SECRET = "8f4c1f6a2b7d9e0c3a5f8b1d4e7a0c2f"

process.env.CRON_SECRET = SECRET
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"

const payout = vi.hoisted(() => ({
  runAutoPayouts: vi.fn(),
  processApprovedWithdrawals: vi.fn(),
  reconcileStuck: vi.fn(),
}))

vi.mock("@/lib/payouts/run", () => ({
  getPayoutService: () => payout,
}))

vi.mock("@/lib/jobs/queue", () => ({
  claimJobs: vi.fn(async () => []),
  completeJob: vi.fn(async () => undefined),
  enqueueJob: vi.fn(async () => "job-id"),
  failJob: vi.fn(async () => undefined),
  releaseJob: vi.fn(async () => undefined),
  recordHeartbeat: vi.fn(async () => undefined),
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({ select: async () => ({ data: [], error: null }) }),
    rpc: async () => ({ data: [], error: null }),
  }),
}))

function callRoute(job: string, authorization?: string) {
  const headers = new Headers()

  if (authorization !== undefined) {
    headers.set("authorization", authorization)
  }

  return routeModule.POST(
    new Request(`http://localhost/api/cron/${job}`, { method: "POST", headers }),
    { params: Promise.resolve({ job }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  payout.runAutoPayouts.mockResolvedValue({
    candidates: 3,
    requested: 2,
    skipped: 1,
    failed: 0,
    stoppedEarly: false,
  })
  payout.processApprovedWithdrawals.mockResolvedValue({
    claimed: 1,
    submitted: 1,
    failed: 0,
    released: 0,
    lowBalance: false,
    otpPending: 0,
    stoppedEarly: false,
  })
  payout.reconcileStuck.mockResolvedValue({ checked: 2, settled: 1, stillPending: 1, failed: 0 })
})

describe("the payout cron jobs", () => {
  it("runs the automatic payouts", async () => {
    const response = await callRoute("payout-run", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      candidates: 3,
      requested: 2,
      skipped: 1,
      failed: 0,
      stoppedEarly: false,
    })
    expect(payout.runAutoPayouts).toHaveBeenCalledTimes(1)
  })

  it("sends the approved withdrawals", async () => {
    const response = await callRoute("payout-process", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, submitted: 1, lowBalance: false })
    expect(payout.processApprovedWithdrawals).toHaveBeenCalledTimes(1)
  })

  it("reports a low balance without failing the call", async () => {
    payout.processApprovedWithdrawals.mockResolvedValueOnce({
      claimed: 4,
      submitted: 0,
      failed: 0,
      released: 4,
      lowBalance: true,
      otpPending: 0,
      stoppedEarly: false,
    })

    const response = await callRoute("payout-process", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ lowBalance: true, released: 4 })
  })

  it("reconciles the stuck withdrawals", async () => {
    const response = await callRoute("payout-reconcile", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, checked: 2, settled: 1 })
  })

  it("answers 500 when a job throws", async () => {
    payout.runAutoPayouts.mockRejectedValueOnce(new Error("down"))

    const response = await callRoute("payout-run", `Bearer ${SECRET}`)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false })
  })

  it("refuses every payout job without the secret", async () => {
    for (const job of ["payout-run", "payout-process", "payout-reconcile"]) {
      const response = await callRoute(job)

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "unauthorized" })
    }

    expect(payout.runAutoPayouts).not.toHaveBeenCalled()
  })
})
