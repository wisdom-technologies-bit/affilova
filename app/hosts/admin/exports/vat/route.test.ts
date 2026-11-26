import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  user: { id: "actor-1" } as { id: string } | null,
  roles: ["admin"] as string[],
  allowed: true,
  rows: [] as unknown[],
  audited: [] as Record<string, unknown>[],
  failed: false,
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

vi.mock("@/lib/admin/db", async () => {
  const { FinanceRpcError } = await import("@/lib/admin/db")

  return {
    FinanceRpcError,
    vatExportRows: async () => {
      if (state.failed) {
        throw new FinanceRpcError("forbidden")
      }

      return state.rows
    },
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.audited.push(row)
        return { error: null }
      },
    }),
  }),
}))

import { GET } from "./route"

function call(period: string): Promise<Response> {
  return GET(new Request(`https://admin.example.test/exports/vat?period=${period}`))
}

const ROW = {
  orderNumber: "AFV-1001",
  paidDateLagos: "2026-09-14",
  basis: "platform_fee",
  rateBps: 750,
  baseKobo: BigInt(100_000),
  taxKobo: BigInt(7_500),
  supplier: "affilova",
  refunded: false,
}

describe("GET /exports/vat", () => {
  beforeEach(() => {
    state.user = { id: "actor-1" }
    state.roles = ["admin"]
    state.allowed = true
    state.rows = [ROW]
    state.audited = []
    state.failed = false
  })

  it("streams a CSV attachment named after the period", async () => {
    const response = await call("2026-09-01")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="vat-2026-09-01.csv"')

    const body = await response.text()
    expect(body.split("\r\n")[0]).toBe(
      "order_number,paid_date_lagos,basis,rate_percent,base_naira,tax_naira,supplier,refunded",
    )
    expect(body).toContain("AFV-1001,2026-09-14,platform_fee,7.5,1000.00,75.00,affilova,no")
  })

  it("writes the audit row", async () => {
    await call("2026-09-01")

    expect(state.audited).toEqual([
      { actor_id: "actor-1", action: "vat.exported", entity_type: "vat_period", entity_id: "2026-09-01", after: { rows: 1 } },
    ])
  })

  it("carries no buyer data", async () => {
    const body = await (await call("2026-09-01")).text()

    expect(body).not.toContain("@")
    expect(body.toLowerCase()).not.toContain("email")
  })

  it("defuses a cell a spreadsheet would run", async () => {
    state.rows = [{ ...ROW, orderNumber: "=1+1" }]

    expect(await (await call("2026-09-01")).text()).toContain("'=1+1")
  })

  it("refuses a signed-out person", async () => {
    state.user = null

    expect((await call("2026-09-01")).status).toBe(401)
  })

  it("refuses a role without vat:manage", async () => {
    state.roles = ["support"]

    expect((await call("2026-09-01")).status).toBe(403)
    expect(state.audited).toHaveLength(0)
  })

  it("refuses a period that is not the first of a month", async () => {
    expect((await call("2026-09-14")).status).toBe(400)
    expect((await call("september")).status).toBe(400)
    expect((await call("")).status).toBe(400)
  })

  it("refuses past the hourly limit", async () => {
    state.allowed = false

    expect((await call("2026-09-01")).status).toBe(429)
  })

  it("answers with a sentence, never the database's words", async () => {
    state.failed = true

    const response = await call("2026-09-01")

    expect(response.status).toBe(500)
    expect(await response.text()).toBe("You do not have access to that.")
  })
})
