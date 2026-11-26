import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The join page's four outcomes.
//
// The page is a server component, so it is awaited and rendered to static
// markup. redirect() throws in Next, so the mock throws too: that is what stops
// the rest of the page from rendering after a redirect.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  accept: null as { ok: boolean } | null,
  productTitle: null as string | null,
  redirects: [] as string[],
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/affiliate/actions", () => ({
  acceptInviteAction: async () => state.accept,
}))

vi.mock("@/lib/affiliate/read-actions", () => ({
  getLiveProductTitle: async () => state.productTitle,
}))

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirects.push(path)
    throw new Error(`redirect:${path}`)
  },
}))

import JoinPage from "./[token]/page"

const TOKEN = "a".repeat(43)

async function render(): Promise<string> {
  const element = await JoinPage({ params: Promise.resolve({ token: TOKEN }) })

  return renderToStaticMarkup(element)
}

beforeEach(() => {
  state.user = null
  state.roles = []
  state.accept = null
  state.productTitle = null
  state.redirects = []

  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
    NEXT_PUBLIC_HOST_PUBLIC: "affilova.vercel.app",
    NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.vercel.app",
    NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.vercel.app",
    NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.vercel.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_COOKIE_DOMAIN: "",
  })) {
    process.env[key] = value
  }
})

describe("the join page", () => {
  it("sends a signed-out visitor to sign in and back again", async () => {
    await expect(render()).rejects.toThrow("redirect:/sign-in")

    expect(state.redirects).toEqual([`/sign-in?next=${encodeURIComponent(`/join/${TOKEN}`)}`])
  })

  it("sends a signed-in visitor without the role to the affiliate sign-up", async () => {
    state.user = { id: "user-1", email: "ada@example.com" }
    state.roles = ["customer"]

    await expect(render()).rejects.toThrow("redirect:/start/affiliate")

    expect(state.redirects).toEqual(["/start/affiliate"])
  })

  it("names the product when the invitation is accepted", async () => {
    state.user = { id: "user-1", email: "ada@example.com" }
    state.roles = ["affiliate"]
    state.accept = { ok: true }
    state.productTitle = "Calm notebook"

    const markup = await render()

    // The product title is its own element so it can be set in bold, so the
    // sentence is asserted in two parts rather than as one string.
    expect(markup).toContain("You can now promote")
    expect(markup).toContain("Calm notebook")
    expect(markup).toContain("Go to your affiliate dashboard")
  })

  it("shows the neutral sentence when the invitation fails", async () => {
    state.user = { id: "user-1", email: "ada@example.com" }
    state.roles = ["affiliate"]
    state.accept = { ok: false }

    const markup = await render()

    expect(markup).toContain("This invite is not valid")
    expect(markup).not.toContain(TOKEN)
  })

  it("shows the neutral sentence when the product is no longer live", async () => {
    state.user = { id: "user-1", email: "ada@example.com" }
    state.roles = ["affiliate"]
    state.accept = { ok: true }
    state.productTitle = null

    const markup = await render()

    expect(markup).toContain("This invite is not valid")
  })

  it("is never indexed", async () => {
    const { metadata } = await import("./[token]/page")

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
