import { NextRequest } from "next/server"
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

// The route reads its database handle from lib/db, which refuses to load
// without DATABASE_URL. Mocking the module keeps the test off the network and
// off the environment.
const dbState = vi.hoisted(() => ({
  queries: [] as string[],
  rows: [] as unknown[],
}))

vi.mock("@/lib/db", () => ({
  sql: async (strings: TemplateStringsArray) => {
    dbState.queries.push(strings.join("?"))
    return dbState.rows
  },
}))

vi.mock("@/lib/brevo", () => ({
  brevoService: { sendEmail: vi.fn(async () => undefined) },
}))

import { createToken } from "@/lib/auth"
import {
  TEST_JWT_SECRET,
  adminPayload,
  affiliatePayload,
  vendorPayload,
} from "@/tests/helpers/legacy-jwt"

import { GET } from "./route"

const tickets = [
  {
    alphanumeric_id: "TCK00001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    subject: "Cannot upload a product image",
    category: "products",
    priority: "high",
    status: "open",
    created_at: "2026-11-13T09:00:00.000Z",
  },
]

async function callRoute(search = "", token?: string): Promise<{ status: number; body: unknown }> {
  if (token !== undefined) {
    cookieState.values.set("auth-token", token)
  }

  const response = await GET(new NextRequest(`http://localhost/api/support/tickets${search}`))
  const body: unknown = await response.json()

  return { status: response.status, body }
}

beforeEach(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  cookieState.values.clear()
  dbState.queries.length = 0
  dbState.rows = tickets
})

describe("GET /api/support/tickets", () => {
  it("answers 401 without a session cookie and reads nothing", async () => {
    const { status, body } = await callRoute()

    expect(status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 403 for a signed in vendor and reads nothing", async () => {
    const token = await createToken(vendorPayload)

    const { status, body } = await callRoute("", token)

    expect(status).toBe(403)
    expect(body).toEqual({ error: "Forbidden" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 403 for another role too, so the list is not merely role-specific", async () => {
    const token = await createToken(affiliatePayload)

    const { status, body } = await callRoute("", token)

    expect(status).toBe(403)
    expect(body).toEqual({ error: "Forbidden" })
    expect(dbState.queries).toHaveLength(0)
  })

  it("answers 200 and lists the tickets for an admin", async () => {
    const token = await createToken(adminPayload)

    const { status, body } = await callRoute("", token)

    expect(status).toBe(200)
    expect(body).toEqual({ tickets })
    expect(dbState.queries.some((query) => query.includes("FROM support_tickets"))).toBe(true)
  })

  it("filters by status for an admin without losing the gate", async () => {
    const token = await createToken(adminPayload)

    const { status } = await callRoute("?status=open", token)

    expect(status).toBe(200)
    expect(dbState.queries.some((query) => query.includes("WHERE status = ?"))).toBe(true)
  })

  it("answers 401 for a token whose signature does not verify", async () => {
    const token = await createToken(adminPayload)

    cookieState.values.set("auth-token", `${token.slice(0, -4)}AAAA`)

    const response = await GET(new NextRequest("http://localhost/api/support/tickets"))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(dbState.queries).toHaveLength(0)
  })
})
