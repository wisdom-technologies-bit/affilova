import { describe, expect, it, vi } from "vitest"

import { resolveStaffMfaEnforced } from "@/lib/env"

import {
  checkStaffAal2,
  getAssurance,
  hasStaffRole,
  isStaffRole,
  MFA_REQUIRED_MESSAGE,
  mfaRedirectPath,
  staffAal2Failure,
  staffAal2RouteGuard,
  STAFF_ROLES,
  verifiedFactors,
  withStaffAal2,
  type MfaClient,
} from "./mfa"
import type { AppRole } from "./session"

function client(options: {
  level?: string | null
  nextLevel?: string | null
  factors?: { id: string; status: string; factor_type?: string }[]
  levelError?: unknown
  factorsError?: unknown
  throws?: boolean
}): MfaClient {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          if (options.throws === true) {
            throw new Error("network")
          }

          return {
            data: {
              currentLevel: options.level ?? null,
              nextLevel: options.nextLevel ?? null,
              currentAuthenticationMethods: [],
            },
            error: options.levelError ?? null,
          }
        },
        listFactors: async () => {
          if (options.throws === true) {
            throw new Error("network")
          }

          return {
            data: { all: options.factors ?? [], totp: [], phone: [] },
            error: options.factorsError ?? null,
          }
        },
      },
    },
  }
}

const VERIFIED = [{ id: "f1", status: "verified", factor_type: "totp" }]
const UNVERIFIED = [{ id: "f1", status: "unverified", factor_type: "totp" }]

function deps(overrides: Partial<Parameters<typeof checkStaffAal2>[1]> = {}) {
  return {
    client: client({ level: "aal2", nextLevel: "aal2", factors: VERIFIED }),
    enforced: true,
    user: { id: "u1" },
    roles: ["admin"] as readonly AppRole[],
    ...overrides,
  }
}

describe("staff roles", () => {
  it("names exactly the four staff roles", () => {
    expect([...STAFF_ROLES]).toEqual(["admin", "finance", "support", "moderator"])
  })

  it("does not treat a customer, vendor or affiliate as staff", () => {
    for (const role of ["customer", "vendor", "affiliate"] as AppRole[]) {
      expect(isStaffRole(role)).toBe(false)
    }
  })

  it("finds a staff role among several", () => {
    expect(hasStaffRole(["customer", "support"])).toBe(true)
    expect(hasStaffRole(["customer", "vendor"])).toBe(false)
    expect(hasStaffRole([])).toBe(false)
  })
})

describe("resolveStaffMfaEnforced", () => {
  it("is on in production and preview when nothing is configured", () => {
    expect(resolveStaffMfaEnforced(undefined, "production")).toBe(true)
    expect(resolveStaffMfaEnforced(undefined, "preview")).toBe(true)
  })

  it("is off in development when nothing is configured", () => {
    expect(resolveStaffMfaEnforced(undefined, "development")).toBe(false)
  })

  it("lets the explicit setting win everywhere, which is the break-glass switch", () => {
    expect(resolveStaffMfaEnforced(false, "production")).toBe(false)
    expect(resolveStaffMfaEnforced(true, "development")).toBe(true)
  })
})

describe("getAssurance", () => {
  it("reads the level and finds a verified factor", async () => {
    const assurance = await getAssurance(client({ level: "aal2", nextLevel: "aal2", factors: VERIFIED }))

    expect(assurance).toEqual({ currentLevel: "aal2", nextLevel: "aal2", hasVerifiedFactor: true })
  })

  it("does not count an unverified factor", async () => {
    const assurance = await getAssurance(client({ level: "aal1", factors: UNVERIFIED }))

    expect(assurance.hasVerifiedFactor).toBe(false)
  })

  it("fails closed when the level cannot be read", async () => {
    const assurance = await getAssurance(client({ levelError: { message: "x" }, factors: VERIFIED }))

    expect(assurance).toEqual({ currentLevel: null, nextLevel: null, hasVerifiedFactor: false })
  })

  it("fails closed when the factors cannot be read", async () => {
    const assurance = await getAssurance(client({ factorsError: { message: "x" } }))

    expect(assurance.hasVerifiedFactor).toBe(false)
  })

  it("fails closed when the client throws", async () => {
    const assurance = await getAssurance(client({ throws: true }))

    expect(assurance).toEqual({ currentLevel: null, nextLevel: null, hasVerifiedFactor: false })
  })

  it("survives an answer in an unexpected shape", async () => {
    const broken: MfaClient = {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: "nonsense", error: null }),
          listFactors: async () => ({ data: null, error: null }),
        },
      },
    }

    expect(await getAssurance(broken)).toEqual({ currentLevel: null, nextLevel: null, hasVerifiedFactor: false })
  })
})

describe("verifiedFactors", () => {
  it("keeps only the verified ones", () => {
    const factors = verifiedFactors({
      all: [
        { id: "a", status: "verified", factor_type: "totp" },
        { id: "b", status: "unverified", factor_type: "totp" },
      ],
    })

    expect(factors).toHaveLength(1)
    expect(factors[0]?.id).toBe("a")
  })

  it("answers nothing for a malformed list", () => {
    expect(verifiedFactors(null)).toEqual([])
    expect(verifiedFactors({ all: "nope" })).toEqual([])
    expect(verifiedFactors({ all: [null, 3] })).toEqual([])
  })
})

describe("checkStaffAal2", () => {
  it("lets a staff member through with a verified factor at AAL2", async () => {
    expect(await checkStaffAal2("/admin/orders", deps())).toEqual({ ok: true })
  })

  it("sends a staff member with no factor to enrol", async () => {
    const decision = await checkStaffAal2(
      "/admin/orders",
      deps({ client: client({ level: "aal1", nextLevel: "aal1", factors: [] }) }),
    )

    expect(decision).toEqual({
      ok: false,
      reason: "enroll",
      redirectTo: "/two-factor/enroll?next=%2Fadmin%2Forders",
    })
  })

  it("sends a staff member with an unverified factor to enrol", async () => {
    const decision = await checkStaffAal2(
      "/admin/orders",
      deps({ client: client({ level: "aal1", factors: UNVERIFIED }) }),
    )

    expect(decision.ok).toBe(false)
    expect(decision.ok === false && decision.reason).toBe("enroll")
  })

  it("sends a staff member with a factor but only AAL1 to verify", async () => {
    const decision = await checkStaffAal2(
      "/admin/orders",
      deps({ client: client({ level: "aal1", nextLevel: "aal2", factors: VERIFIED }) }),
    )

    expect(decision).toEqual({
      ok: false,
      reason: "verify",
      redirectTo: "/two-factor/verify?next=%2Fadmin%2Forders",
    })
  })

  it("does not affect a signed-in account with no staff role", async () => {
    expect(
      await checkStaffAal2("/account", deps({ roles: ["customer", "affiliate"], client: client({ factors: [] }) })),
    ).toEqual({ ok: true })
  })

  it("does not affect a visitor who is not signed in", async () => {
    expect(await checkStaffAal2("/admin", deps({ user: null, client: client({ factors: [] }) }))).toEqual({ ok: true })
  })

  it("does nothing when enforcement is off, which is the break-glass switch", async () => {
    expect(
      await checkStaffAal2("/admin", deps({ enforced: false, client: client({ level: "aal1", factors: [] }) })),
    ).toEqual({ ok: true })
  })

  it("checks every staff role", async () => {
    for (const role of STAFF_ROLES) {
      const decision = await checkStaffAal2("/admin", deps({ roles: [role], client: client({ factors: [] }) }))

      expect(decision.ok).toBe(false)
    }
  })

  it("keeps the next path safe", async () => {
    const decision = await checkStaffAal2(
      "https://evil.example/steal",
      deps({ client: client({ factors: [] }) }),
    )

    expect(decision.ok).toBe(false)
    expect(decision.ok === false && decision.redirectTo.startsWith("/two-factor/enroll?next=")).toBe(true)
    expect(decision.ok === false && decision.redirectTo).not.toContain("evil.example")
  })

  it("encodes the next path once", () => {
    expect(mfaRedirectPath("verify", "/admin/orders?status=paid")).toBe(
      "/two-factor/verify?next=%2Fadmin%2Forders%3Fstatus%3Dpaid",
    )
  })
})

describe("staffAal2Failure", () => {
  it("is null when the session is good", async () => {
    expect(await staffAal2Failure("/admin", deps())).toBeNull()
  })

  it("is the one sentence when it is not", async () => {
    expect(await staffAal2Failure("/admin", deps({ client: client({ factors: [] }) }))).toBe(MFA_REQUIRED_MESSAGE)
    expect(MFA_REQUIRED_MESSAGE).toBe("Two-factor verification required.")
  })
})

describe("withStaffAal2", () => {
  it("runs the action when the session is good", async () => {
    const action = vi.fn(async () => ({ ok: true as const, data: "done" }))
    const wrapped = withStaffAal2("/admin", action, deps())

    expect(await wrapped()).toEqual({ ok: true, data: "done" })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("never runs the action without a second factor", async () => {
    const action = vi.fn(async () => ({ ok: true as const, data: "done" }))
    const wrapped = withStaffAal2("/admin", action, deps({ client: client({ factors: [] }) }))

    expect(await wrapped()).toEqual({ ok: false, error: MFA_REQUIRED_MESSAGE })
    expect(action).not.toHaveBeenCalled()
  })

  it("passes the arguments through", async () => {
    const action = vi.fn(async (id: string, n: number) => ({ ok: true as const, data: `${id}:${n}` }))
    const wrapped = withStaffAal2("/admin", action, deps())

    expect(await wrapped("u1", 3)).toEqual({ ok: true, data: "u1:3" })
  })
})

describe("staffAal2RouteGuard", () => {
  it("is null when the session is good", async () => {
    expect(await staffAal2RouteGuard("/admin/exports/vat", deps())).toBeNull()
  })

  it("answers 403 with the sentence when it is not", async () => {
    const response = await staffAal2RouteGuard("/admin/exports/vat", deps({ client: client({ factors: [] }) }))

    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({ error: MFA_REQUIRED_MESSAGE })
  })
})
