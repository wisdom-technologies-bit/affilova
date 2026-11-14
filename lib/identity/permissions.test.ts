import { describe, expect, it } from "vitest"

import type { AppRole } from "./session"
import { ACTIONS, can, type Action } from "./permissions"

// The matrix, written out independently of the implementation, so the test
// fails if the rulebook changes rather than agreeing with itself.
const EXPECTED: Record<Action, readonly AppRole[]> = {
  "area:account": ["customer", "affiliate", "vendor", "admin", "finance", "support", "moderator"],
  "area:affiliate": ["affiliate"],
  "area:merchant": ["vendor"],
  "area:admin": ["admin", "finance", "support", "moderator"],
  "products:review": ["admin", "moderator"],
  "tickets:read": ["admin", "support"],
  "payouts:approve": ["admin", "finance"],
  "vat:manage": ["admin", "finance"],
  "settings:read": ["admin", "finance", "support", "moderator"],
  "settings:write": ["admin", "finance"],
  "users:suspend": ["admin"],
  "roles:grant": ["admin"],
}

const ROLES: readonly AppRole[] = [
  "customer",
  "affiliate",
  "vendor",
  "admin",
  "finance",
  "support",
  "moderator",
]

describe("ACTIONS", () => {
  it("lists every action exactly once", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort())
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length)
  })
})

describe("can", () => {
  // Every action against every role, one assertion each.
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const allowed = EXPECTED[action].includes(role)

      it(`${action} for ${role} is ${allowed}`, () => {
        expect(can([role], action)).toBe(allowed)
      })
    }
  }

  it("denies every action when a user holds no roles", () => {
    for (const action of ACTIONS) {
      expect(can([], action)).toBe(false)
    }
  })

  it("allows an action when any one of the held roles grants it", () => {
    expect(can(["customer", "support"], "tickets:read")).toBe(true)
    expect(can(["customer", "vendor"], "area:merchant")).toBe(true)
    expect(can(["customer", "vendor"], "area:affiliate")).toBe(false)
  })

  it("returns false for an action that is not in the matrix", () => {
    expect(can(["admin"], "products:delete-everything" as Action)).toBe(false)
    expect(can(["admin"], "" as Action)).toBe(false)
  })

  it("does not let one role inherit another", () => {
    // admin is powerful, but it is not every role.
    expect(can(["admin"], "area:merchant")).toBe(false)
    expect(can(["admin"], "area:affiliate")).toBe(false)
    expect(can(["admin"], "settings:write")).toBe(true)
    expect(can(["admin"], "payouts:approve")).toBe(true)

    // finance cannot do the admin-only parts.
    expect(can(["finance"], "users:suspend")).toBe(false)
    expect(can(["finance"], "roles:grant")).toBe(false)

    // support can read settings and tickets, and nothing more.
    expect(can(["support"], "settings:read")).toBe(true)
    expect(can(["support"], "settings:write")).toBe(false)
    expect(can(["support"], "payouts:approve")).toBe(false)

    // moderator can review products and read settings, and nothing more.
    expect(can(["moderator"], "products:review")).toBe(true)
    expect(can(["moderator"], "tickets:read")).toBe(false)
    expect(can(["moderator"], "vat:manage")).toBe(false)
  })
})
