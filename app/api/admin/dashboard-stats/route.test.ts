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
  responders: [] as { pattern: RegExp; rows: unknown }[],
}))

vi.mock("@neondatabase/serverless", () => ({
  neon: () => async (strings: TemplateStringsArray) => {
    const text = strings.join("?")
    dbState.queries.push(text)
    const responder = dbState.responders.find((entry) => entry.pattern.test(text))
    return responder ? responder.rows : []
  },
}))

import { createToken } from "@/lib/auth"
import {
  TEST_JWT_SECRET,
  adminPayload,
  expiredToken,
  vendorPayload,
} from "@/tests/helpers/legacy-jwt"

import { GET } from "./route"

const MONTH = "2026-01-15T00:00:00.000Z"

const totalUsers = { total_users: 10, total_vendors: 4, total_affiliates: 6 }
const totalProducts = { total_products: 5, active_products: 3 }
const totalTransactions = {
  total_transactions: 7,
  total_sales: 70000,
  platform_earnings: 7000,
  completed_transactions: 6,
}
const totalWithdrawals = {
  total_withdrawals: 2,
  total_withdrawn: 5000,
  pending_withdrawals: 1,
}
const totalSupport = { total_tickets: 3, open_tickets: 1 }
const monthlyRevenue = [{ month: MONTH, revenue: 1000, transactions: 2 }]
const topVendors = [
  { id: "vnd_1", vendor_name: "Ada Lovelace", sales_count: 3, total_sales: 9000 },
]

const expectedResponse = {
  users: totalUsers,
  products: totalProducts,
  transactions: totalTransactions,
  withdrawals: totalWithdrawals,
  support: totalSupport,
  monthlyRevenue: [{ month: "Jan 26", revenue: 10, transactions: 2 }],
  topVendors: [{ name: "Ada Lovelace", sales: 3, revenue: 90 }],
}

function primeDatabase() {
  dbState.responders = [
    { pattern: /SUM\(platform_fee\) as revenue/, rows: monthlyRevenue },
    { pattern: /vendor_name/, rows: topVendors },
    { pattern: /platform_earnings/, rows: [totalTransactions] },
    { pattern: /pending_withdrawals/, rows: [totalWithdrawals] },
    { pattern: /open_tickets/, rows: [totalSupport] },
    { pattern: /active_products/, rows: [totalProducts] },
    { pattern: /total_affiliates/, rows: [totalUsers] },
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
  dbState.responders = []
})

describe("GET /api/admin/dashboard-stats", () => {
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

  it("answers 401 for an expired session cookie", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await expiredToken(adminPayload, TEST_JWT_SECRET))

    const { status } = await callRoute()

    expect(status).toBe(401)
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 403 for a vendor token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(vendorPayload))

    const { status, body } = await callRoute()

    expect(status).toBe(403)
    expect(body).toEqual({ error: "Forbidden" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 200 with the unchanged payload for an admin token", async () => {
    primeDatabase()
    cookieState.values.set("auth-token", await createToken(adminPayload))

    const { status, body } = await callRoute()

    expect(status).toBe(200)
    expect(body).toEqual(expectedResponse)
    expect(dbState.queries).toHaveLength(7)
  })
})
