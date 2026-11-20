import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

// The affiliate server actions.
//
// Every action is tested for the same four things: who is calling, whether they
// may, whether the input is well formed, and whether the allowance is left. The
// database is a mock here on purpose: the SQL has its own harness, and what is
// being tested is the wiring, the messages and the one secret this code creates.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  allowed: true,
  limitKeys: [] as string[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcData: null as unknown,
  rpcError: null as { message: string } | null,
  rows: [] as unknown[],
  rowsError: null as { message: string } | null,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (options: { key: string }) => {
    state.limitKeys.push(options.key)

    return { allowed: state.allowed, remaining: 1, resetAt: new Date("2026-11-20T12:00:00.000Z") }
  },
  rateLimitKey: (parts: readonly string[]) => `key:${parts.join("|")}`,
}))

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

class FakeQuery {
  select(): this {
    return this
  }

  eq(): this {
    return this
  }

  order(): this {
    return this
  }

  limit(): this {
    return this
  }

  or(): this {
    return this
  }

  then<TResult>(
    onfulfilled: (value: { data: unknown; error: unknown }) => TResult,
  ): Promise<TResult> {
    return Promise.resolve({ data: state.rows, error: state.rowsError }).then(onfulfilled)
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => new FakeQuery(),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })

      return { data: state.rpcData, error: state.rpcError }
    },
  }),
}))

import {
  acceptInviteAction,
  archiveLinkAction,
  createInviteAction,
  createLinkAction,
  decideAccessAction,
  listMyLinksAction,
  requestAccessAction,
} from "./actions"
import { hashInviteToken } from "./token"

const AFFILIATE = "11111111-1111-4111-8111-111111111111"
const VENDOR = "22222222-2222-4222-8222-222222222222"
const PRODUCT = "33333333-3333-4333-8333-333333333333"
const LINK = "44444444-4444-4444-8444-444444444444"

beforeEach(() => {
  state.user = { id: AFFILIATE, email: "ada@example.com" }
  state.roles = ["customer", "affiliate"]
  state.allowed = true
  state.limitKeys = []
  state.rpcCalls = []
  state.rpcData = null
  state.rpcError = null
  state.rows = []
  state.rowsError = null
})

describe("authorisation", () => {
  it("refuses every action without a session", async () => {
    state.user = null

    await expect(createLinkAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "Sign in to continue.",
    })
    await expect(archiveLinkAction({ linkId: LINK })).resolves.toEqual({
      ok: false,
      error: "Sign in to continue.",
    })
    await expect(listMyLinksAction({})).resolves.toEqual({ ok: false, error: "Sign in to continue." })
    await expect(requestAccessAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "Sign in to continue.",
    })
    await expect(acceptInviteAction({ token: "a".repeat(43) })).resolves.toEqual({
      ok: false,
      error: "Sign in to continue.",
    })
    await expect(
      decideAccessAction({ affiliateId: AFFILIATE, productId: PRODUCT, decision: "approved" }),
    ).resolves.toEqual({ ok: false, error: "Sign in to continue." })

    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses the affiliate actions to someone without the affiliate role", async () => {
    state.roles = ["customer"]

    await expect(createLinkAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a decision to a customer", async () => {
    state.roles = ["customer"]

    await expect(
      decideAccessAction({ affiliateId: AFFILIATE, productId: PRODUCT, decision: "approved" }),
    ).resolves.toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("lets a vendor decide", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["customer", "vendor"]

    await expect(
      decideAccessAction({ affiliateId: AFFILIATE, productId: PRODUCT, decision: "approved" }),
    ).resolves.toEqual({ ok: true })

    expect(state.rpcCalls[0]?.name).toBe("decide_product_access")
  })

  it("lets an admin decide", async () => {
    state.user = { id: VENDOR, email: "admin@example.com" }
    state.roles = ["customer", "admin"]

    await expect(
      decideAccessAction({ affiliateId: AFFILIATE, productId: PRODUCT, decision: "blocked" }),
    ).resolves.toEqual({ ok: true })
  })
})

describe("createLinkAction", () => {
  it("creates a link for the signed-in affiliate", async () => {
    state.rpcData = { link_id: LINK, code: "abcdefgh", alias: "ada-deals" }

    const result = await createLinkAction({ productId: PRODUCT, label: "Bio", alias: "ada-deals" })

    expect(result).toEqual({ ok: true, linkId: LINK, code: "abcdefgh", alias: "ada-deals" })
    expect(state.rpcCalls[0]).toEqual({
      name: "create_affiliate_link",
      args: { p_affiliate: AFFILIATE, p_product: PRODUCT, p_label: "Bio", p_alias: "ada-deals" },
    })
  })

  it("never takes the affiliate from the input", async () => {
    state.rpcData = { link_id: LINK, code: "abcdefgh", alias: null }

    await createLinkAction({
      productId: PRODUCT,
      affiliateId: VENDOR,
      affiliate_id: VENDOR,
    } as unknown)

    expect(state.rpcCalls[0]?.args.p_affiliate).toBe(AFFILIATE)
  })

  it("sends null for an empty label and alias", async () => {
    state.rpcData = { link_id: LINK, code: "abcdefgh", alias: null }

    await createLinkAction({ productId: PRODUCT, label: "  ", alias: "" })

    expect(state.rpcCalls[0]?.args.p_label).toBeNull()
    expect(state.rpcCalls[0]?.args.p_alias).toBeNull()
  })

  it("refuses a malformed product id before any work", async () => {
    await expect(createLinkAction({ productId: "not-a-uuid" })).resolves.toEqual({
      ok: false,
      error: "Check the form and try again.",
    })
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.limitKeys).toHaveLength(0)
  })

  it("refuses once the allowance is used up", async () => {
    state.allowed = false

    await expect(createLinkAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("turns a database code into a sentence, never the raw text", async () => {
    state.rpcError = { message: "alias_taken" }

    const result = await createLinkAction({ productId: PRODUCT, alias: "ada-deals" })

    expect(result).toEqual({
      ok: false,
      error: "That short name is already used by another link. Try another one.",
    })
  })

  it("hides an unknown database error behind the generic sentence", async () => {
    state.rpcError = { message: 'duplicate key value violates unique constraint "affiliate_links_code_key"' }

    const result = await createLinkAction({ productId: PRODUCT })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.error).toBe("Something went wrong. Please try again.")
      expect(result.error).not.toContain("affiliate_links")
    }
  })

  it("refuses a link the affiliate may not promote", async () => {
    state.rpcError = { message: "not_allowed" }

    await expect(createLinkAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "You cannot promote this product right now.",
    })
  })

  it("refuses at the link limit", async () => {
    state.rpcError = { message: "link_limit" }

    await expect(createLinkAction({ productId: PRODUCT })).resolves.toMatchObject({ ok: false })
  })
})

describe("archiveLinkAction", () => {
  it("archives the caller's own link", async () => {
    await expect(archiveLinkAction({ linkId: LINK })).resolves.toEqual({ ok: true })
    expect(state.rpcCalls[0]).toEqual({
      name: "archive_affiliate_link",
      args: { p_affiliate: AFFILIATE, p_link: LINK },
    })
  })

  it("reports a link that is not theirs as not found", async () => {
    state.rpcError = { message: "not_found" }

    await expect(archiveLinkAction({ linkId: LINK })).resolves.toEqual({
      ok: false,
      error: "That link could not be found.",
    })
  })

  it("refuses a malformed link id", async () => {
    await expect(archiveLinkAction({ linkId: "nope" })).resolves.toMatchObject({ ok: false })
    expect(state.rpcCalls).toHaveLength(0)
  })
})

describe("listMyLinksAction", () => {
  const row = (id: string, createdAt: string): Record<string, unknown> => ({
    id,
    product_id: PRODUCT,
    code: "abcdefgh",
    alias: null,
    label: "bio",
    status: "active",
    created_at: createdAt,
  })

  it("returns one page and a cursor for the next", async () => {
    state.rows = [
      row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-11-20T10:00:00.000Z"),
      row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-11-19T10:00:00.000Z"),
      row("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-11-18T10:00:00.000Z"),
    ]

    const result = await listMyLinksAction({ limit: 2 })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.items).toHaveLength(2)
      expect(result.items[0]?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      expect(result.nextCursor).not.toBeNull()
    }
  })

  it("answers no cursor when the page is the last one", async () => {
    state.rows = [row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-11-20T10:00:00.000Z")]

    const result = await listMyLinksAction({})

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.nextCursor).toBeNull()
    }
  })

  it("ignores a cursor that is not ours", async () => {
    state.rows = []

    const result = await listMyLinksAction({ cursor: "not-a-cursor" })

    expect(result.ok).toBe(true)
  })

  it("reports a database failure without its text", async () => {
    state.rowsError = { message: 'relation "affiliate_links" does not exist' }

    const result = await listMyLinksAction({})

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })

  it("refuses a limit outside the allowed range", async () => {
    await expect(listMyLinksAction({ limit: 500 })).resolves.toMatchObject({ ok: false })
  })
})

describe("requestAccessAction", () => {
  it("returns the status the database answered", async () => {
    state.rpcData = "pending"

    await expect(requestAccessAction({ productId: PRODUCT, note: "I have an audience" })).resolves.toEqual({
      ok: true,
      status: "pending",
    })

    expect(state.rpcCalls[0]).toEqual({
      name: "request_product_access",
      args: { p_affiliate: AFFILIATE, p_product: PRODUCT, p_note: "I have an audience" },
    })
  })

  it("reports a blocked affiliate in words", async () => {
    state.rpcError = { message: "blocked" }

    await expect(requestAccessAction({ productId: PRODUCT })).resolves.toEqual({
      ok: false,
      error: "This product's vendor has blocked you from promoting it.",
    })
  })

  it("refuses a note longer than 500 characters", async () => {
    await expect(requestAccessAction({ productId: PRODUCT, note: "x".repeat(501) })).resolves.toMatchObject({
      ok: false,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })
})

describe("createInviteAction", () => {
  it("returns the token once and stores only its hash", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["customer", "vendor"]
    state.rpcData = LINK

    const result = await createInviteAction({ productId: PRODUCT, maxUses: 5, expiresDays: 7 })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    // 32 random bytes, base64url, no padding.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.joinPath).toBe(`/join/${result.token}`)

    const args = state.rpcCalls[0]?.args
    expect(args?.p_token_hash).toBe(createHash("sha256").update(result.token).digest("hex"))
    expect(args?.p_token_hash).toBe(hashInviteToken(result.token))
    expect(args?.p_token_hash).not.toBe(result.token)
    expect(JSON.stringify(state.rpcCalls)).not.toContain(result.token)
    expect(args?.p_actor).toBe(VENDOR)
  })

  it("creates a different token every time", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["vendor"]
    state.rpcData = LINK

    const first = await createInviteAction({ productId: PRODUCT, maxUses: 1, expiresDays: 1 })
    const second = await createInviteAction({ productId: PRODUCT, maxUses: 1, expiresDays: 1 })

    expect(first.ok && second.ok).toBe(true)

    if (first.ok && second.ok) {
      expect(first.token).not.toBe(second.token)
    }
  })

  it("refuses an affiliate who is not a vendor", async () => {
    await expect(createInviteAction({ productId: PRODUCT, maxUses: 1, expiresDays: 1 })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses a product that is not the caller's", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["vendor"]
    state.rpcError = { message: "forbidden" }

    await expect(createInviteAction({ productId: PRODUCT, maxUses: 1, expiresDays: 1 })).resolves.toEqual({
      ok: false,
      error: "You do not have access to that.",
    })
  })

  it("refuses a use count or an expiry outside the range", async () => {
    state.user = { id: VENDOR, email: "vendor@example.com" }
    state.roles = ["vendor"]

    await expect(createInviteAction({ productId: PRODUCT, maxUses: 0, expiresDays: 7 })).resolves.toMatchObject({
      ok: false,
    })
    await expect(createInviteAction({ productId: PRODUCT, maxUses: 5, expiresDays: 400 })).resolves.toMatchObject({
      ok: false,
    })
  })
})

describe("acceptInviteAction", () => {
  it("hashes the token before sending it and returns the product", async () => {
    const token = "a".repeat(43)
    state.rpcData = { product_id: PRODUCT, status: "approved" }

    await expect(acceptInviteAction({ token })).resolves.toEqual({
      ok: true,
      productId: PRODUCT,
      status: "approved",
    })

    expect(state.rpcCalls[0]).toEqual({
      name: "accept_affiliate_invite",
      args: { p_affiliate: AFFILIATE, p_token_hash: hashInviteToken(token) },
    })
    expect(JSON.stringify(state.rpcCalls)).not.toContain(token)
  })

  it("reports a dead invitation in one sentence", async () => {
    state.rpcError = { message: "invite_invalid" }

    await expect(acceptInviteAction({ token: "b".repeat(43) })).resolves.toEqual({
      ok: false,
      error: "That invitation is not valid any more. Ask the vendor for a new one.",
    })
  })

  it("refuses a token that is far too short to be one", async () => {
    await expect(acceptInviteAction({ token: "abc" })).resolves.toMatchObject({ ok: false })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it("refuses an absurdly long token before hashing it", async () => {
    await expect(acceptInviteAction({ token: "a".repeat(200) })).resolves.toMatchObject({ ok: false })
    expect(state.rpcCalls).toHaveLength(0)
  })
})
