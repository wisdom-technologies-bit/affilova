import { beforeEach, describe, expect, it, vi } from "vitest"

import { notFound, redirect } from "next/navigation"

import { getAuthUser, getUserRoles } from "./session"
import { apiRequirePermission, requirePermission, requireUser } from "./guards"

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock("./session", () => ({ getAuthUser: vi.fn(), getUserRoles: vi.fn() }))

// redirect() and notFound() throw in Next.js: that is how the page body is
// stopped. The mocks throw too, so a guard that forgot to return cannot be
// mistaken for one that did.
class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`)
  }
}

class NotFound extends Error {}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(redirect).mockImplementation((url: string): never => {
    throw new Redirected(url)
  })

  vi.mocked(notFound).mockImplementation((): never => {
    throw new NotFound()
  })
})

function signedOut(): void {
  vi.mocked(getAuthUser).mockResolvedValue(null)
}

function signedIn(roles: string[] = ["customer"]): void {
  vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1", email: "person@example.com" })
  vi.mocked(getUserRoles).mockResolvedValue(
    roles as Awaited<ReturnType<typeof getUserRoles>>,
  )
}

describe("requireUser", () => {
  it("returns the user and their roles", async () => {
    signedIn(["customer", "vendor"])

    await expect(requireUser("/start")).resolves.toEqual({
      user: { id: "user-1", email: "person@example.com" },
      roles: ["customer", "vendor"],
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("sends a signed-out visitor to sign in, encoded", async () => {
    signedOut()

    await expect(requireUser("/start")).rejects.toThrow(Redirected)
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2Fstart")
  })

  it("encodes a nested path and its query", async () => {
    signedOut()

    await expect(requireUser("/start/vendor?step=2")).rejects.toThrow(Redirected)
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2Fstart%2Fvendor%3Fstep%3D2")
  })

  it("falls back to / for a next path that leaves the site", async () => {
    signedOut()

    await expect(requireUser("https://evil.example.com/steal")).rejects.toThrow(Redirected)
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2F")
  })
})

describe("requirePermission", () => {
  it("returns the user when a role grants the action", async () => {
    signedIn(["customer", "vendor"])

    await expect(requirePermission("area:merchant", "/start")).resolves.toEqual({
      user: { id: "user-1", email: "person@example.com" },
      roles: ["customer", "vendor"],
    })
    expect(notFound).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("calls notFound() by default", async () => {
    signedIn(["customer"])

    await expect(requirePermission("area:admin", "/admin")).rejects.toThrow(NotFound)
    expect(notFound).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
  })

  it("redirects to /start when the page asks for that", async () => {
    signedIn(["customer"])

    await expect(requirePermission("area:merchant", "/start/vendor", "start")).rejects.toThrow(
      Redirected,
    )
    expect(redirect).toHaveBeenCalledWith("/start")
    expect(notFound).not.toHaveBeenCalled()
  })

  it("sends a signed-out visitor to sign in before deciding anything", async () => {
    signedOut()

    await expect(requirePermission("area:admin", "/admin")).rejects.toThrow(Redirected)
    expect(redirect).toHaveBeenCalledWith("/sign-in?next=%2Fadmin")
    expect(notFound).not.toHaveBeenCalled()
    expect(getUserRoles).not.toHaveBeenCalled()
  })
})

describe("apiRequirePermission", () => {
  it("returns 401 with Unauthorized when nobody is signed in", async () => {
    signedOut()

    const result = await apiRequirePermission("settings:read")

    expect(result.ok).toBe(false)

    if (result.ok) {
      throw new Error("expected a failure")
    }

    expect(result.response.status).toBe(401)
    await expect(result.response.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns 403 with Forbidden when the role is not enough", async () => {
    signedIn(["customer"])

    const result = await apiRequirePermission("settings:write")

    expect(result.ok).toBe(false)

    if (result.ok) {
      throw new Error("expected a failure")
    }

    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({ error: "Forbidden" })
  })

  it("returns the user and roles when the action is allowed", async () => {
    signedIn(["customer", "finance"])

    await expect(apiRequirePermission("vat:manage")).resolves.toEqual({
      ok: true,
      user: { id: "user-1", email: "person@example.com" },
      roles: ["customer", "finance"],
    })
  })
})
