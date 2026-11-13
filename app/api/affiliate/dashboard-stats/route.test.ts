import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string) => {
      cookieState.values.set(name, value)
    },
    delete: (name: string) => {
      cookieState.values.delete(name)
    },
  }),
}))

const dbState = vi.hoisted(() => ({
  queries: [] as string[],
  params: [] as unknown[][],
  responders: [] as { pattern: RegExp; rows: unknown }[],
}))

vi.mock("@neondatabase/serverless", () => ({
  neon: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    dbState.queries.push(text)
    dbState.params.push(values)
    const responder = dbState.responders.find((entry) => entry.pattern.test(text))
    return responder ? responder.rows : []
  },
}))

import { createToken } from "@/lib/auth"
import {
  TEST_JWT_SECRET,
  adminPayload,
  affiliatePayload,
  vendorPayload,
} from "@/tests/helpers/legacy-jwt"

import { GET } from "./route"

const MONTH = "2026-01-15T00:00:00.000Z"

const affiliateRow = [{ id: "aff_1" }]
const linkStats = [{ total_clicks: 100, total_conversions: 20 }]
const commissionStats = [{ total_commissions: 12000, pending_commissions: 3000 }]
const productsCount = [{ approved_products: 4 }]
const monthlyPerformance = [
  { month: MONTH, clicks: 10, conversions: 2, commissions: 500 },
]
const topProducts = [
  { title: "Widget", clicks: 10, conversions: 2, conversion_rate: "20.00" },
]

const expectedResponse = {
  clicks: 100,
  conversions: 20,
  conversionRate: 20,
  totalCommissions: 120,
  pendingCommissions: 30,
  approvedProducts: 4,
  monthlyPerformance: [{ month: "Jan 26", clicks: 10, conversions: 2, commissions: 5 }],
  topProducts: [{ name: "Widget", clicks: 10, conversions: 2, conversionRate: "20.00" }],
}

function primeDatabase() {
  dbState.responders = [
    { pattern: /FROM affiliates WHERE user_id/, rows: affiliateRow },
    { pattern: /as total_conversions/, rows: linkStats },
    { pattern: /as total_commissions/, rows: commissionStats },
    { pattern: /as approved_products/, rows: productsCount },
    { pattern: /SUM\(t.affiliate_commission\) as commissions/, rows: monthlyPerformance },
    { pattern: /as conversion_rate/, rows: topProducts },
  ]
}

async function callRoute() {
  const response = await GET()
  const body: unknown = await response.json()

  return { status: response.status, body }
}

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  cookieState.values.clear()
  dbState.queries.length = 0
  dbState.params.length = 0
  dbState.responders = []
})

describe("GET /api/affiliate/dashboard-stats", () => {
  it("answers 401 without a session cookie", async () => {
    primeDatabase()

    const { status, body } = await callRoute()

    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 401 for a forged plain user_id cookie with no auth-token", async () => {
    primeDatabase()
    cookieState.values.set("user_id", "usr_attacker")

    const { status, body } = await callRoute()

    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 403 for an admin token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(adminPayload))

    const { status, body } = await callRoute()

    expect(status).toBe(403)
    expect(body).toEqual({ error: "Forbidden" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 403 for a vendor token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    const { status } = await callRoute()

    expect(status).toBe(403)
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 200 with the unchanged payload for an affiliate token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(affiliatePayload))

    const { status, body } = await callRoute()

    expect(status).toBe(200)
    expect(body).toEqual(expectedResponse)
    expect(dbState.queries).toHaveLength(6)
  })

  it("looks the affiliate up by the session userId, not the plain cookie", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(affiliatePayload))
    cookieState.values.set("user_id", "usr_attacker")

    const { status } = await callRoute()

    expect(status).toBe(200)
    expect(dbState.queries[0]).toContain("SELECT id FROM affiliates WHERE user_id =")
    expect(dbState.params[0]).toEqual([affiliatePayload.userId])
  })

  it("keeps answering 404 when the session user has no affiliate row", async () => {
    dbState.responders = []
    cookieState.values.set("auth-token", await createToken(affiliatePayload))

    const { status, body } = await callRoute()

    expect(status).toBe(404)
    expect(body).toEqual({ error: "Affiliate not found" })
  })
})
