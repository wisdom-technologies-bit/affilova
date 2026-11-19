import { beforeEach, describe, expect, it, vi } from "vitest"

// The two payment schedules, wired into the cron endpoint.
//
// The point of these tests is that the endpoint calls the right database
// function with the right batch size and answers with real counts: a schedule
// that silently does nothing is worse than one that fails loudly.

const state = vi.hoisted(() => ({
  authorized: true,
  reconcileSummary: { checked: 2, paid: 1, skipped: 1, failed: 0, stoppedEarly: false },
  expired: 7,
  reconcileDeps: null as null | {
    listReferences: unknown
    verifyTransaction: unknown
    processPaidOrder: unknown
  },
  expireBatch: 0,
  heartbeats: [] as { job: string; status: string }[],
}))

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ CRON_SECRET: "0123456789abcdef0123456789abcdef" }),
}))

vi.mock("@/lib/jobs/cron-auth", () => ({
  isValidCronSecret: () => state.authorized,
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/jobs/handlers", () => ({
  getHandler: () => undefined,
}))

vi.mock("@/lib/jobs/queue", () => ({
  claimJobs: vi.fn(async () => []),
  completeJob: vi.fn(),
  enqueueJob: vi.fn(async () => "job-id"),
  failJob: vi.fn(),
  recordHeartbeat: async (job: string, status: string) => {
    state.heartbeats.push({ job, status })
  },
  releaseJob: vi.fn(),
}))

vi.mock("@/lib/jobs/runner", () => ({
  runProcessQueue: async () => ({ claimed: 0, completed: 0, failed: 0, released: 0 }),
}))

vi.mock("@/lib/paystack/client", () => ({
  verifyTransaction: async (reference: string) => ({
    id: 1,
    status: "success",
    reference,
    amountKobo: 40333,
    currency: "NGN",
    feesKobo: 0,
    channel: "card",
    paidAt: null,
    gatewayResponse: "Successful",
  }),
}))

vi.mock("@/lib/commerce/reconcile", () => ({
  runReconcilePending: async (deps: typeof state.reconcileDeps) => {
    state.reconcileDeps = deps

    return state.reconcileSummary
  },
}))

vi.mock("@/lib/commerce/db", () => ({
  expirePendingOrders: async (limit: number) => {
    state.expireBatch = limit

    return state.expired
  },
  listOrdersNeedingVerification: async () => ["afv_abc123"],
  processPaidOrder: async () => ({ status: "processed", orderId: null, number: null }),
  purgeOldWebhookEvents: async () => 0,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({ select: async () => ({ data: [], error: null }) }),
    rpc: async () => ({ data: 0, error: null }),
  }),
}))

import { POST } from "./route"

function call(job: string): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/cron/${job}`, {
      method: "POST",
      headers: { authorization: "Bearer 0123456789abcdef0123456789abcdef" },
    }),
    { params: Promise.resolve({ job }) },
  )
}

beforeEach(() => {
  state.authorized = true
  state.heartbeats.length = 0
  state.reconcileDeps = null
  state.expireBatch = 0
})

describe("reconcile-pending", () => {
  it("runs the sweep with the database functions and answers with its counts", async () => {
    const response = await call("reconcile-pending")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      checked: 2,
      paid: 1,
      skipped: 1,
      failed: 0,
      stoppedEarly: false,
    })

    expect(state.reconcileDeps?.listReferences).toBeTypeOf("function")
    expect(state.reconcileDeps?.verifyTransaction).toBeTypeOf("function")
    expect(state.reconcileDeps?.processPaidOrder).toBeTypeOf("function")
  })

  it("records a heartbeat", async () => {
    await call("reconcile-pending")

    expect(state.heartbeats).toContainEqual({ job: "reconcile-pending", status: "ok" })
  })
})

describe("expire-orders", () => {
  it("expires the agreed batch and reports how many", async () => {
    const response = await call("expire-orders")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, expired: 7 })
    expect(state.expireBatch).toBe(500)
  })
})

describe("the endpoint itself", () => {
  it("refuses a request without the secret", async () => {
    state.authorized = false

    const response = await call("reconcile-pending")

    expect(response.status).toBe(401)
  })

  it("still refuses a name it does not know", async () => {
    const response = await call("pay-everyone")

    expect(response.status).toBe(404)
  })
})
