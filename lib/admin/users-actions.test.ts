import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  user: { id: "actor-1" } as { id: string } | null,
  roles: ["admin"] as string[],
  enforced: true,
  hasFactor: true,
  aal: "aal2" as "aal1" | "aal2",
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  data: null as unknown,
  error: null as { code?: string; message?: string } | null,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

// The second factor is stubbed at its own boundary: lib/identity/mfa.test.ts
// owns the rule, this file owns what the actions do when the rule says no.
vi.mock("@/lib/identity/mfa", () => ({
  staffAal2Failure: async () => {
    if (!state.enforced) {
      return null
    }

    if (!state.hasFactor) {
      return "Two-factor verification required."
    }

    return state.aal === "aal2" ? null : "Two-factor verification required."
  },
}))

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args })

      if (state.error !== null) {
        return { data: null, error: state.error }
      }

      return { data: state.data, error: null }
    },
  }),
}))

import * as actions from "./users-actions"

beforeEach(() => {
  state.user = { id: "actor-1" }
  state.roles = ["admin"]
  state.enforced = true
  state.hasFactor = true
  state.aal = "aal2"
  state.rpc = []
  state.data = null
  state.error = null
})

const listRow = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "ada@example.com",
  display_name: "Ada Obi",
  status: "active",
  verification_level: "verified",
  roles: ["admin", "customer"],
  created_at: "2026-01-04T10:00:00.000Z",
  total_count: 41,
}

describe("listUsersAction", () => {
  it("returns a page and the unpaged total", async () => {
    state.data = [listRow]

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.data.total).toBe(41)
      expect(result.data.rows).toHaveLength(1)
      expect(result.data.rows[0]?.roles).toEqual(["admin", "customer"])
      expect(result.data.rows[0]?.displayName).toBe("Ada Obi")
    }
  })

  it("asks for the right page and the fixed page size", async () => {
    state.data = []

    await actions.listUsersAction({ search: "ada", status: "active", role: "admin", page: 2 })

    expect(state.rpc[0]?.name).toBe("admin_list_users")
    expect(state.rpc[0]?.args).toMatchObject({
      p_search: "ada",
      p_status: "active",
      p_role: "admin",
      p_limit: 25,
      p_offset: 50,
    })
  })

  it("sends null rather than a blank search", async () => {
    state.data = []

    await actions.listUsersAction({ search: "   ", status: null, role: null, page: 0 })

    expect(state.rpc[0]?.args.p_search).toBeNull()
  })

  it("refuses a caller without the permission, before asking the database", async () => {
    state.roles = ["support"]

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result).toEqual({ ok: false, error: "You do not have access to that." })
    expect(state.rpc).toHaveLength(0)
  })

  it("refuses a session that has not completed the second factor", async () => {
    state.aal = "aal1"

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result).toEqual({ ok: false, error: "Two-factor verification required." })
    expect(state.rpc).toHaveLength(0)
  })

  it("refuses a caller who is not signed in", async () => {
    state.user = null

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result).toEqual({ ok: false, error: "Sign in again to continue." })
  })

  it("answers one generic sentence when the function fails", async () => {
    state.error = { code: "42P01", message: "relation does not exist" }

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error).not.toContain("relation")
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  it("skips rows it cannot read an id from", async () => {
    state.data = [listRow, { email: "no-id@example.com" }, null]

    const result = await actions.listUsersAction({ search: "", status: null, role: null, page: 0 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.data.rows).toHaveLength(1)
    }
  })
})

describe("getUserAction", () => {
  it("returns the person with every role", async () => {
    state.data = {
      id: "11111111-1111-1111-1111-111111111111",
      email: "ada@example.com",
      display_name: "Ada Obi",
      status: "active",
      verification_level: "pro",
      created_at: "2026-01-04T10:00:00.000Z",
      roles: [
        { role: "admin", status: "active", created_at: "2026-01-04T10:00:00.000Z" },
        { role: "support", status: "revoked", created_at: "2026-01-05T10:00:00.000Z" },
      ],
    }

    const result = await actions.getUserAction("11111111-1111-1111-1111-111111111111")

    expect(result.ok).toBe(true)

    if (result.ok && result.data !== null) {
      expect(result.data.roles).toHaveLength(2)
      expect(result.data.roles[1]?.status).toBe("revoked")
      expect(result.data.verificationLevel).toBe("pro")
    }
  })

  it("answers null for an id the function does not know", async () => {
    state.data = null

    const result = await actions.getUserAction("99999999-9999-9999-9999-999999999999")

    expect(result).toEqual({ ok: true, data: null })
  })
})

describe("the role changes", () => {
  it("passes the signed-in person as the actor, never one from the input", async () => {
    const result = await actions.grantStaffRoleAction({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "support",
      p_actor: "somebody-else",
    })

    expect(result.ok).toBe(true)
    expect(state.rpc[0]?.name).toBe("admin_grant_staff_role")
    expect(state.rpc[0]?.args.p_actor).toBe("actor-1")
  })

  it("refuses a role outside the staff list", async () => {
    const result = await actions.grantStaffRoleAction({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "vendor",
    })

    expect(result).toEqual({ ok: false, error: "Choose a staff role." })
    expect(state.rpc).toHaveLength(0)
  })

  it("refuses a userId that is not a uuid", async () => {
    const result = await actions.revokeStaffRoleAction({ userId: "not-a-uuid", role: "admin" })

    expect(result.ok).toBe(false)
    expect(state.rpc).toHaveLength(0)
  })

  it("turns the last-admin refusal into a sentence a person can act on", async () => {
    state.error = { code: "check_violation", message: "the last active admin cannot be removed" }

    const result = await actions.revokeStaffRoleAction({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "admin",
    })

    expect(result).toEqual({
      ok: false,
      error: "That would leave no active admin. Give someone else the admin role first.",
    })
  })

  it("turns a permission refusal from the database into the same sentence the app uses", async () => {
    state.error = { code: "insufficient_privilege", message: "only an active admin may change staff access" }

    const result = await actions.grantStaffRoleAction({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "finance",
    })

    expect(result).toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("needs roles:grant, not merely a staff role", async () => {
    state.roles = ["finance"]

    const result = await actions.grantStaffRoleAction({
      userId: "22222222-2222-2222-2222-222222222222",
      role: "support",
    })

    expect(result.ok).toBe(false)
    expect(state.rpc).toHaveLength(0)
  })
})

describe("the account changes", () => {
  it("suspends through the function, with the actor from the session", async () => {
    const result = await actions.setUserStatusAction({
      userId: "22222222-2222-2222-2222-222222222222",
      status: "suspended",
    })

    expect(result.ok).toBe(true)
    expect(state.rpc[0]?.args).toEqual({
      p_user_id: "22222222-2222-2222-2222-222222222222",
      p_status: "suspended",
      p_actor: "actor-1",
    })
  })

  it("refuses a status the enum does not have", async () => {
    const result = await actions.setUserStatusAction({
      userId: "22222222-2222-2222-2222-222222222222",
      status: "deleted",
    })

    expect(result).toEqual({ ok: false, error: "Choose a status." })
  })

  it("sets a verification level", async () => {
    const result = await actions.setVerificationLevelAction({
      userId: "22222222-2222-2222-2222-222222222222",
      level: "verified",
    })

    expect(result.ok).toBe(true)
    expect(state.rpc[0]?.name).toBe("admin_set_verification_level")
  })

  it("refuses a level the enum does not have", async () => {
    const result = await actions.setVerificationLevelAction({
      userId: "22222222-2222-2222-2222-222222222222",
      level: "gold",
    })

    expect(result).toEqual({ ok: false, error: "Choose a verification level." })
  })

  it("answers the no-such-user sentence when the person is gone", async () => {
    state.error = { code: "no_data_found", message: "no such user" }

    const result = await actions.setVerificationLevelAction({
      userId: "22222222-2222-2222-2222-222222222222",
      level: "pro",
    })

    expect(result).toEqual({ ok: false, error: "That account no longer exists." })
  })
})

describe("the form entry points", () => {
  it("reads the fields and answers null when the change went through", async () => {
    const form = new FormData()
    form.set("userId", "22222222-2222-2222-2222-222222222222")
    form.set("role", "moderator")

    const answer = await actions.submitGrantRole(null, form)

    expect(answer).toBeNull()
    expect(state.rpc[0]?.args.p_role).toBe("moderator")
  })

  it("answers the sentence when the change did not go through", async () => {
    state.error = { code: "check_violation", message: "the last active admin cannot be removed" }

    const form = new FormData()
    form.set("userId", "22222222-2222-2222-2222-222222222222")
    form.set("role", "admin")

    const answer = await actions.submitRevokeRole(null, form)

    expect(answer).toBe("That would leave no active admin. Give someone else the admin role first.")
  })

  it("handles a form with no fields at all", async () => {
    const answer = await actions.submitUserStatus(null, new FormData())

    expect(answer).toBe("Choose a status.")
    expect(state.rpc).toHaveLength(0)
  })
})
