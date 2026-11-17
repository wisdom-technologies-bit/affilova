import { beforeEach, describe, expect, it, vi } from "vitest"

import { headers } from "next/headers"

import { getRequestPath } from "./current-app"

// The path the middleware forwarded, as a layout reads it.

vi.mock("next/headers", () => ({ headers: vi.fn() }))

type RequestHeaders = Awaited<ReturnType<typeof headers>>

function withHeaders(values: Record<string, string>): void {
  vi.mocked(headers).mockResolvedValue(new Headers(values) as unknown as RequestHeaders)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getRequestPath", () => {
  it("returns the path and query the middleware forwarded", async () => {
    withHeaders({ "x-affilova-path": "/products?page=2" })

    await expect(getRequestPath()).resolves.toBe("/products?page=2")
  })

  it("returns the root when the header is missing", async () => {
    withHeaders({})

    await expect(getRequestPath()).resolves.toBe("/")
  })

  it("returns the root when the header is empty", async () => {
    withHeaders({ "x-affilova-path": "" })

    await expect(getRequestPath()).resolves.toBe("/")
  })

  it("refuses a value that would leave the site", async () => {
    withHeaders({ "x-affilova-path": "https://evil.example.com/products" })
    await expect(getRequestPath()).resolves.toBe("/")

    withHeaders({ "x-affilova-path": "//evil.example.com" })
    await expect(getRequestPath()).resolves.toBe("/")

    withHeaders({ "x-affilova-path": "/%2F%2Fevil.example.com" })
    await expect(getRequestPath()).resolves.toBe("/")
  })
})
