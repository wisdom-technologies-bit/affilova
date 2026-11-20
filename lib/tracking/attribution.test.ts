import { beforeEach, describe, expect, it, vi } from "vitest"

// readAttribution, with next/headers mocked.
//
// It has one job: turn the cookie into a click id for one product, and answer
// null rather than throw when anything about that is not right. Checkout must
// never fail because attribution could not be read.

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
  throws: false,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (cookieState.throws) {
      throw new Error("cookies() called outside a request scope")
    }

    return {
      get: (name: string) => {
        const value = cookieState.values.get(name)

        return value === undefined ? undefined : { name, value }
      },
    }
  },
}))

import { readAttribution } from "./attribution"

const PRODUCT = "11111111-1111-4111-8111-111111111111"
const OTHER_PRODUCT = "22222222-2222-4222-8222-222222222222"
const CLICK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER_CLICK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

beforeEach(() => {
  cookieState.values.clear()
  cookieState.throws = false
})

describe("readAttribution", () => {
  it("returns the click remembered for the product", async () => {
    cookieState.values.set("afv_ref", `${PRODUCT}:${CLICK}|${OTHER_PRODUCT}:${OTHER_CLICK}`)

    await expect(readAttribution(PRODUCT)).resolves.toEqual({ clickId: CLICK })
    await expect(readAttribution(OTHER_PRODUCT)).resolves.toEqual({ clickId: OTHER_CLICK })
  })

  it("returns null when there is no cookie", async () => {
    await expect(readAttribution(PRODUCT)).resolves.toBeNull()
  })

  it("returns null for a product that is not in the cookie", async () => {
    cookieState.values.set("afv_ref", `${OTHER_PRODUCT}:${OTHER_CLICK}`)

    await expect(readAttribution(PRODUCT)).resolves.toBeNull()
  })

  it("returns null for a malformed cookie", async () => {
    cookieState.values.set("afv_ref", "not-a-uuid:not-a-uuid")

    await expect(readAttribution(PRODUCT)).resolves.toBeNull()
  })

  it("returns null for a product id that is not a uuid", async () => {
    cookieState.values.set("afv_ref", `${PRODUCT}:${CLICK}`)

    await expect(readAttribution("not-a-product")).resolves.toBeNull()
  })

  it("returns null instead of throwing outside a request scope", async () => {
    cookieState.throws = true

    await expect(readAttribution(PRODUCT)).resolves.toBeNull()
  })

  it("ignores another product's cookie value", async () => {
    cookieState.values.set("afv_ref", `${PRODUCT}:${CLICK}`)
    cookieState.values.set("sb-access-token", "whatever")

    await expect(readAttribution(PRODUCT)).resolves.toEqual({ clickId: CLICK })
  })
})
