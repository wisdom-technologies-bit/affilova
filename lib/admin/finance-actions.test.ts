import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  user: { id: "actor-1" } as { id: string } | null,
  roles: ["admin"] as string[],
  allowed: true,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  failure: null as unknown,
  enqueued: [] as { type: string; dedupeKey?: string }[],
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimitKey: (parts: string[]) => parts.join(":"),
  rateLimit: async () => ({ allowed: state.allowed, remaining: 0, resetAt: new Date() }),
}))

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: async (input: { type: string; dedupeKey?: string }) => {
    state.enqueued.push(input)
    return "job-1"
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args })

      if (state.failure !== null) {
        return { data: null, error: { message: state.failure } }
      }

      return { data: { status: "won" }, error: null }
    },
  }),
}))

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./screen-types")>("./screen-types")

  const record = (name: string, answer: unknown) => async (actor: string, ...rest: unknown[]) => {
    state.calls.push({ name, args: { actor, rest } })

    if (state.failure !== null) {
      throw new Error("raw database text: relation orders does not exist")
    }

    return answer
  }

  return {
    FinanceRpcError: class FinanceRpcError extends Error {},
    adminOverview: record("overview", actual.parseOverview({ gmv_kobo: 5 })),
    adminDailySeries: record("series", actual.parseDailySeries([])),
    adminOrders: record("orders", { rows: [], nextCursor: null }),
    adminOrderDetail: record("detail", null),
    adminRefunds: record("refunds", { rows: [], nextCursor: null }),
    adminDisputes: record("disputes", { rows: [], nextCursor: null }),
    adminLedger: record("ledger", { rows: [], nextCursor: null, accounts: [] }),
    adminTrialBalance: record("trial", actual.parseTrialBalance({ balanced: true })),
    adminReconciliationRuns: record("runs", { rows: [], nextCursor: null }),
    vatPeriods: record("vat_periods", []),
    vatPeriodDetail: record("vat_detail", actual.parseVatDetail({ summary: {} })),
    vatExportRows: record("vat_export", []),
    retryRefundSubmission: record("retry", { enqueue: true, orderReference: "afv_1" }),
    vatReminderTargets: async () => null,
    recordReconciliationRun: async () => ({ diffKobo: BigInt(0) }),
  }
})

import {
  addVatAdjustmentAction,
  decideDisputeAction,
  getAdminOverviewAction,
  getOrderDetailAction,
  listLedgerAction,
  listOrdersAction,
  listRefundsAction,
  listVatPeriodsAction,
  retryRefundSubmissionAction,
  setVatPeriodStatusAction,
} from "./finance-actions"

const FROM = "2026-11-01T00:00:00+01:00"
const TO = "2026-11-25T23:59:59+01:00"

describe("finance actions", () => {
  beforeEach(() => {
    state.user = { id: "actor-1" }
    state.roles = ["admin"]
    state.allowed = true
    state.calls = []
    state.rpc = []
    state.failure = null
    state.enqueued = []
  })

  it("refuses everyone who is not signed in, without touching the database", async () => {
    state.user = null

    for (const result of [
      await getAdminOverviewAction({ from: FROM, to: TO }),
      await listOrdersAction({}),
      await listRefundsAction({}),
      await listLedgerAction({}),
      await listVatPeriodsAction({ year: 2026 }),
    ]) {
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("Sign in to continue.")
    }

    expect(state.calls).toHaveLength(0)
  })

  it("refuses support the ledger, the money and a refund decision", async () => {
    state.roles = ["support"]

    expect((await listLedgerAction({})).ok).toBe(false)
    expect((await getAdminOverviewAction({ from: FROM, to: TO })).ok).toBe(false)
    expect((await retryRefundSubmissionAction({ requestId: "99999999-9999-4999-8999-999999999906" })).ok).toBe(false)
    expect((await decideDisputeAction({ orderId: "99999999-9999-4999-8999-999999999906", outcome: "won", note: "x".repeat(20) })).ok).toBe(false)
    expect((await setVatPeriodStatusAction({ period: "2026-09-01", status: "filed" })).ok).toBe(false)
  })

  it("lets support read an order and a refund list", async () => {
    state.roles = ["support"]

    expect((await listOrdersAction({})).ok).toBe(true)
    expect((await listRefundsAction({})).ok).toBe(true)
    expect((await getOrderDetailAction({ orderId: "99999999-9999-4999-8999-999999999906" })).ok).toBe(false)
  })

  it("always passes the authenticated id as the actor, never one from the input", async () => {
    await getAdminOverviewAction({ from: FROM, to: TO })

    expect(state.calls[0]?.args.actor).toBe("actor-1")
  })

  it("refuses a malformed range before asking the database", async () => {
    const result = await getAdminOverviewAction({ from: "yesterday", to: TO })

    expect(result.ok).toBe(false)
    expect(state.calls).toHaveLength(0)
  })

  it("refuses a cursor that is not a cursor", async () => {
    const result = await listOrdersAction({ cursor: "not-a-cursor" })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("That page has expired. Start again from the first page.")
  })

  it("refuses when the limiter says no, and fails closed", async () => {
    state.allowed = false

    const result = await listOrdersAction({})

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe("Too many attempts. Please wait a few minutes and try again.")
    expect(state.calls).toHaveLength(0)
  })

  it("never returns raw database text", async () => {
    state.failure = "relation \"orders\" does not exist"

    const result = await listOrdersAction({})

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).not.toContain("relation")
    expect(result.ok === false && result.error).toBe("Something went wrong. Please try again.")
  })

  it("requires a note of at least ten characters on a dispute decision", async () => {
    const short = await decideDisputeAction({ orderId: "99999999-9999-4999-8999-999999999906", outcome: "lost", note: "too short" })

    expect(short.ok).toBe(false)
    expect(state.rpc).toHaveLength(0)

    const long = await decideDisputeAction({
      orderId: "99999999-9999-4999-8999-999999999906",
      outcome: "lost",
      note: "The buyer received the file and the chargeback is valid.",
    })

    expect(long.ok).toBe(true)
    expect(state.rpc[0]?.name).toBe("resolve_dispute")
    expect(state.rpc[0]?.args.p_outcome).toBe("lost")
  })

  it("queues a retry under the existing dedupe key", async () => {
    const result = await retryRefundSubmissionAction({ requestId: "99999999-9999-4999-8999-999999999906" })

    expect(result.ok).toBe(true)
    expect(state.enqueued).toEqual([
      { type: "refund_submit", payload: { requestId: "99999999-9999-4999-8999-999999999906" }, dedupeKey: "refund_submit:99999999-9999-4999-8999-999999999906" },
    ])
  })

  it("refuses a remittance with no amount", async () => {
    const result = await setVatPeriodStatusAction({ period: "2026-09-01", status: "remitted" })

    expect(result.ok).toBe(false)
    expect(state.rpc).toHaveLength(0)
  })

  it("sends the amount as a string of kobo, so no float ever crosses the wire", async () => {
    await setVatPeriodStatusAction({ period: "2026-09-01", status: "remitted", remittedAmountKobo: 3_100_000 })

    expect(state.rpc[0]?.args.p_remitted_amount_kobo).toBe("3100000")
  })

  it("refuses an adjustment with no reason and one of zero", async () => {
    expect((await addVatAdjustmentAction({ period: "2026-09-01", amountKobo: 1_000, reason: "no" })).ok).toBe(false)
    expect((await addVatAdjustmentAction({ period: "2026-09-01", amountKobo: 0, reason: "Rounding correction" })).ok).toBe(false)
    expect(state.rpc).toHaveLength(0)
  })

  it("refuses a period that is not the first of a month", async () => {
    expect((await listVatPeriodsAction({ year: 1990 })).ok).toBe(false)
    expect((await setVatPeriodStatusAction({ period: "2026-09-14", status: "filed" })).ok).toBe(false)
  })
})
