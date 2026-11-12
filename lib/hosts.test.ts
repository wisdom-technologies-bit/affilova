import { afterEach, describe, expect, it } from "vitest"

import {
  appForHost,
  hostMapFromEnv,
  normalizeHost,
  parseAppName,
  type HostMap,
} from "./hosts"

const hosts: HostMap = {
  public: "affilova.vercel.app",
  affiliate: "affiliates.affilova.vercel.app",
  merchant: "merchants.affilova.vercel.app",
  account: "account.affilova.vercel.app",
  admin: "admin.affilova.vercel.app",
}

describe("appForHost", () => {
  it("maps each configured host to its app", () => {
    expect(appForHost({ host: "affilova.vercel.app", hosts, appEnv: "production" })).toBe("public")
    expect(appForHost({ host: "affiliates.affilova.vercel.app", hosts, appEnv: "production" })).toBe(
      "affiliate",
    )
    expect(appForHost({ host: "merchants.affilova.vercel.app", hosts, appEnv: "production" })).toBe(
      "merchant",
    )
    expect(appForHost({ host: "account.affilova.vercel.app", hosts, appEnv: "production" })).toBe(
      "account",
    )
    expect(appForHost({ host: "admin.affilova.vercel.app", hosts, appEnv: "production" })).toBe(
      "admin",
    )
  })

  it("returns public for an unknown host", () => {
    expect(appForHost({ host: "elsewhere.example.com", hosts, appEnv: "production" })).toBe("public")
  })

  it("strips the port before matching", () => {
    expect(appForHost({ host: "affilova.vercel.app:3000", hosts, appEnv: "production" })).toBe(
      "public",
    )
    expect(appForHost({ host: "admin.affilova.vercel.app:3000", hosts, appEnv: "production" })).toBe(
      "admin",
    )
  })

  it("matches an uppercase host", () => {
    expect(appForHost({ host: "ADMIN.AFFILOVA.VERCEL.APP", hosts, appEnv: "production" })).toBe(
      "admin",
    )
  })

  it("matches a host with a trailing dot", () => {
    expect(appForHost({ host: "affiliates.affilova.vercel.app.", hosts, appEnv: "production" })).toBe(
      "affiliate",
    )
  })

  it("returns public for an empty or undefined host", () => {
    expect(appForHost({ host: "", hosts, appEnv: "production" })).toBe("public")
    expect(appForHost({ host: "   ", hosts, appEnv: "production" })).toBe("public")
    expect(appForHost({ host: null, hosts, appEnv: "production" })).toBe("public")
    expect(appForHost({ host: undefined, hosts, appEnv: "production" })).toBe("public")
  })

  it("returns public when the host map is empty", () => {
    expect(appForHost({ host: "admin.affilova.vercel.app", hosts: {}, appEnv: "production" })).toBe(
      "public",
    )
  })

  it("honours the override in development and preview", () => {
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "development", override: "merchant" }),
    ).toBe("merchant")
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "preview", override: "admin" }),
    ).toBe("admin")
  })

  it("ignores the override in production", () => {
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "production", override: "admin" }),
    ).toBe("public")
  })

  it("ignores the override when the app environment is undefined", () => {
    expect(
      appForHost({ host: "affiliates.affilova.vercel.app", hosts, appEnv: undefined, override: "admin" }),
    ).toBe("affiliate")
  })

  it("ignores an invalid override", () => {
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "development", override: "vendor" }),
    ).toBe("public")
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "development", override: "" }),
    ).toBe("public")
    expect(
      appForHost({ host: "affilova.vercel.app", hosts, appEnv: "development", override: null }),
    ).toBe("public")
  })
})

describe("normalizeHost", () => {
  it("trims, lowercases, strips the port and a trailing dot", () => {
    expect(normalizeHost("  AFFILOVA.VERCEL.APP:3000  ")).toBe("affilova.vercel.app")
    expect(normalizeHost("affilova.vercel.app.")).toBe("affilova.vercel.app")
    expect(normalizeHost("affilova.vercel.app.:3000")).toBe("affilova.vercel.app")
  })

  it("returns an empty string for null or undefined", () => {
    expect(normalizeHost(null)).toBe("")
    expect(normalizeHost(undefined)).toBe("")
  })
})

describe("parseAppName", () => {
  it("accepts the five app names", () => {
    expect(parseAppName("public")).toBe("public")
    expect(parseAppName("affiliate")).toBe("affiliate")
    expect(parseAppName("merchant")).toBe("merchant")
    expect(parseAppName("account")).toBe("account")
    expect(parseAppName("admin")).toBe("admin")
  })

  it("rejects everything else", () => {
    expect(parseAppName("vendor")).toBe("public")
    expect(parseAppName("Admin")).toBe("public")
    expect(parseAppName(" admin")).toBe("public")
    expect(parseAppName("")).toBe("public")
    expect(parseAppName(null)).toBe("public")
    expect(parseAppName(undefined)).toBe("public")
  })
})

describe("hostMapFromEnv", () => {
  const variableNames = [
    "NEXT_PUBLIC_HOST_PUBLIC",
    "NEXT_PUBLIC_HOST_AFFILIATE",
    "NEXT_PUBLIC_HOST_MERCHANT",
    "NEXT_PUBLIC_HOST_ACCOUNT",
    "NEXT_PUBLIC_HOST_ADMIN",
  ] as const

  const original = new Map(variableNames.map((name) => [name, process.env[name]]))

  afterEach(() => {
    for (const name of variableNames) {
      const value = original.get(name)

      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  it("reads the five host variables", () => {
    process.env.NEXT_PUBLIC_HOST_PUBLIC = "affilova.vercel.app"
    process.env.NEXT_PUBLIC_HOST_AFFILIATE = "affiliates.affilova.vercel.app"
    process.env.NEXT_PUBLIC_HOST_MERCHANT = "merchants.affilova.vercel.app"
    process.env.NEXT_PUBLIC_HOST_ACCOUNT = "account.affilova.vercel.app"
    process.env.NEXT_PUBLIC_HOST_ADMIN = "admin.affilova.vercel.app"

    expect(hostMapFromEnv()).toEqual({
      public: "affilova.vercel.app",
      affiliate: "affiliates.affilova.vercel.app",
      merchant: "merchants.affilova.vercel.app",
      account: "account.affilova.vercel.app",
      admin: "admin.affilova.vercel.app",
    })
  })

  it("leaves out missing and blank variables", () => {
    process.env.NEXT_PUBLIC_HOST_PUBLIC = "affilova.vercel.app"
    delete process.env.NEXT_PUBLIC_HOST_AFFILIATE
    process.env.NEXT_PUBLIC_HOST_MERCHANT = "   "
    delete process.env.NEXT_PUBLIC_HOST_ACCOUNT
    delete process.env.NEXT_PUBLIC_HOST_ADMIN

    expect(hostMapFromEnv()).toEqual({ public: "affilova.vercel.app" })
  })
})
