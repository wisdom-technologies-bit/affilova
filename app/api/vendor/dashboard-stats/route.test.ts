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

const vendorRow = [{ id: "vnd_1" }]
const productStats = [{ total_products: 4, active_products: 3 }]
const salesStats = [{ total_sales: 6, total_revenue: 60000, vendor_earnings: 48000 }]
const affiliateStats = [{ active_affiliates: 2 }]
const monthlySales = [{ month: MONTH, sales_count: 2, revenue: 1000 }]
const topProducts = [
  { id: "prd_1", title: "Widget", sales_count: 2, total_revenue: 2000 },
]

const expectedResponse = {
  products: { total_products: 4, active_products: 3 },
  sales: { total_sales: 6, total_revenue: 60000, vendor_earnings: 48000 },
  affiliates: { active_affiliates: 2 },
  monthlySales: [{ month: "Jan 26", sales: 2, revenue: 10 }],
  topProducts: [{ name: "Widget", sales: 2, revenue: 20 }],
}

function primeDatabase() {
  dbState.responders = [
    { pattern: /FROM vendors WHERE user_id/, rows: vendorRow },
    { pattern: /SUM\(amount\) as revenue/, rows: monthlySales },
    { pattern: /FROM products p/, rows: topProducts },
    { pattern: /active_products/, rows: productStats },
    { pattern: /vendor_earnings/, rows: salesStats },
    { pattern: /active_affiliates/, rows: affiliateStats },
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

describe("GET /api/vendor/dashboard-stats", () => {
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

  it("answers 403 for an affiliate token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(affiliatePayload))

    const { status } = await callRoute()

    expect(status).toBe(403)
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 200 with the unchanged payload for a vendor token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    const { status, body } = await callRoute()

    expect(status).toBe(200)
    expect(body).toEqual(expectedResponse)
    expect(dbState.queries).toHaveLength(6)
  })

  it("looks the vendor up by the session userId, not the plain cookie", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(vendorPayload))
    cookieState.values.set("user_id", "usr_attacker")

    const { status } = await callRoute()

    expect(status).toBe(200)
    expect(dbState.queries[0]).toContain("SELECT id FROM vendors WHERE user_id =")
    expect(dbState.params[0]).toEqual([vendorPayload.userId])
  })

  it("keeps answering 404 when the session user has no vendor row", async () => {
    primeDatabase()
    dbState.responders = []
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    const { status, body } = await callRoute()

    expect(status).toBe(404)
    expect(body).toEqual({ error: "Vendor not found" })
  })
})
