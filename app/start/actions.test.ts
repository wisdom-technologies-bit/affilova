import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { headers } from "next/headers"

import { getAuthUser } from "@/lib/identity/session"
import { POLICY_VERSION } from "@/lib/identity/policies"
import { getSupabaseAdminClient } from "@/lib/supabase/admin"

import { becomeAffiliateAction, becomeVendorAction } from "./actions"

import type { AffiliateInput, VendorInput } from "@/lib/identity/onboarding-schemas"

vi.mock("next/headers", () => ({ headers: vi.fn() }))
vi.mock("@/lib/identity/session", () => ({ getAuthUser: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }))

const USER_ID = "11111111-1111-1111-1111-111111111111"
const CLIENT_IP = "203.0.113.7"

const rpc = vi.fn()

type RpcCall = { name: string; args: Record<string, unknown> }

function lastRpcCall(): RpcCall {
  const call = rpc.mock.calls.at(-1)

  if (call === undefined) {
    throw new Error("rpc was not called")
  }

  return { name: String(call[0]), args: call[1] as Record<string, unknown> }
}

function respondWith(data: unknown, error: { code?: string; message?: string } | null = null): void {
  rpc.mockResolvedValue({ data, error })
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(headers).mockResolvedValue(
    new Headers({ "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1` }),
  )
  vi.mocked(getAuthUser).mockResolvedValue({ id: USER_ID, email: "person@example.com" })
  vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof getSupabaseAdminClient
  >)
})

const vendorInput: VendorInput = {
  businessName: "Shop One",
  slug: "shop-one",
  supportEmail: "shop@example.com",
  phone: "",
  acceptTerms: true,
}

const affiliateInput: AffiliateInput = {
  username: "promoter_one",
  promotionChannels: ["whatsapp", "instagram"],
  acceptTerms: true,
}

describe("becomeVendorAction", () => {
  it("creates the vendor row and reports created true", async () => {
    respondWith({ created: true })

    const result = await becomeVendorAction(vendorInput)

    expect(result).toEqual({ ok: true, created: true })

    const call = lastRpcCall()

    expect(call.name).toBe("become_vendor")
    expect(call.args).toEqual({
      p_user: USER_ID,
      p_business_name: "Shop One",
      p_slug: "shop-one",
      p_support_email: "shop@example.com",
      p_phone: null,
      p_country: "NG",
      p_terms_version: POLICY_VERSION,
      p_ip_hash: createHash("sha256").update(CLIENT_IP).digest("hex"),
    })
  })

  it("sends the phone number when one was typed", async () => {
    respondWith({ created: true })

    await becomeVendorAction({ ...vendorInput, phone: " +234 801 234 5678 " })

    expect(lastRpcCall().args.p_phone).toBe("+234 801 234 5678")
  })

  it("normalises the handle and the email before sending them", async () => {
    respondWith({ created: true })

    await becomeVendorAction({ ...vendorInput, slug: " Shop-One ", supportEmail: "SHOP@Example.com" })

    const call = lastRpcCall()

    expect(call.args.p_slug).toBe("shop-one")
    expect(call.args.p_support_email).toBe("shop@example.com")
  })

  it("reports created false when the user already has a vendor row", async () => {
    respondWith({ created: false })

    await expect(becomeVendorAction(vendorInput)).resolves.toEqual({ ok: true, created: false })
  })

  it("hashes the first forwarded address and never sends the raw one", async () => {
    respondWith({ created: true })

    await becomeVendorAction(vendorInput)

    const hash = lastRpcCall().args.p_ip_hash

    expect(typeof hash).toBe("string")
    expect(hash).not.toBe(CLIENT_IP)
    expect(hash).not.toContain(CLIENT_IP)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(createHash("sha256").update(CLIENT_IP).digest("hex"))
  })

  it("sends a null hash when there is no forwarded address", async () => {
    respondWith({ created: true })
    vi.mocked(headers).mockResolvedValue(new Headers())

    await becomeVendorAction(vendorInput)

    expect(lastRpcCall().args.p_ip_hash).toBeNull()
  })

  it("maps a unique violation on the slug to a field error", async () => {
    respondWith(null, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "vendor_profiles_slug_key"',
    })

    const result = await becomeVendorAction(vendorInput)

    expect(result).toEqual({
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: { slug: "That store address is taken." },
    })
  })

  it("never returns a raw database message", async () => {
    respondWith(null, {
      code: "42P01",
      message: 'relation "public.vendor_profiles" does not exist',
    })

    const result = await becomeVendorAction(vendorInput)

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      fieldErrors: {},
    })

    const serialised = JSON.stringify(result)

    expect(serialised).not.toContain("relation")
    expect(serialised).not.toContain("42P01")
    expect(serialised).not.toContain("vendor_profiles")
  })

  it("maps the inactive profile message to the generic failure", async () => {
    respondWith(null, { code: "P0001", message: "profile_not_active" })

    const result = await becomeVendorAction(vendorInput)

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      fieldErrors: {},
    })
    expect(JSON.stringify(result)).not.toContain("profile_not_active")
  })

  it("returns field errors and writes nothing when the form is invalid", async () => {
    const result = await becomeVendorAction({ ...vendorInput, slug: "-shop", phone: "call me" })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.fieldErrors.slug).toContain("3 to 40")
      expect(result.fieldErrors.phone).toBeDefined()
    }

    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a submission without acceptTerms", async () => {
    const result = await becomeVendorAction({ ...vendorInput, acceptTerms: false })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.fieldErrors.acceptTerms).toBeDefined()
    }

    expect(rpc).not.toHaveBeenCalled()
  })

  it("asks a signed-out visitor to sign in again and writes nothing", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null)

    const result = await becomeVendorAction(vendorInput)

    expect(result).toEqual({ ok: false, error: "Please sign in again.", fieldErrors: {} })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("becomeAffiliateAction", () => {
  it("creates the affiliate row and reports created true", async () => {
    respondWith({ created: true })

    const result = await becomeAffiliateAction(affiliateInput)

    expect(result).toEqual({ ok: true, created: true })

    const call = lastRpcCall()

    expect(call.name).toBe("become_affiliate")
    expect(call.args).toEqual({
      p_user: USER_ID,
      p_username: "promoter_one",
      p_promotion_channels: ["whatsapp", "instagram"],
      p_country: "NG",
      p_terms_version: POLICY_VERSION,
      p_ip_hash: createHash("sha256").update(CLIENT_IP).digest("hex"),
    })
  })

  it("reports created false when the user already has an affiliate row", async () => {
    respondWith({ created: false })

    await expect(becomeAffiliateAction(affiliateInput)).resolves.toEqual({
      ok: true,
      created: false,
    })
  })

  it("maps a unique violation on the username to a field error", async () => {
    respondWith(null, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "affiliate_profiles_username_key"',
    })

    const result = await becomeAffiliateAction(affiliateInput)

    expect(result).toEqual({
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: { username: "That username is taken." },
    })
  })

  it("never returns a raw database message", async () => {
    respondWith(null, { code: "23503", message: 'violates foreign key constraint "profiles"' })

    const result = await becomeAffiliateAction(affiliateInput)

    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      fieldErrors: {},
    })
    expect(JSON.stringify(result)).not.toContain("foreign key")
  })

  it("returns field errors and writes nothing when the form is invalid", async () => {
    const result = await becomeAffiliateAction({
      username: "login",
      promotionChannels: [],
      acceptTerms: true,
    })

    expect(result.ok).toBe(false)

    if (!result.ok) {
      expect(result.fieldErrors.username).toContain("reserved")
    }

    expect(rpc).not.toHaveBeenCalled()
  })

  it("asks a signed-out visitor to sign in again and writes nothing", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null)

    const result = await becomeAffiliateAction(affiliateInput)

    expect(result).toEqual({ ok: false, error: "Please sign in again.", fieldErrors: {} })
    expect(rpc).not.toHaveBeenCalled()
  })
})
