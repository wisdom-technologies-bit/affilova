import { beforeEach, describe, expect, it, vi } from "vitest"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

import { getAuthUser, getUserRoles } from "./session"

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }))

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type AdminClient = ReturnType<typeof getSupabaseAdminClient>

type GetUserResult = {
  data: { user: { id: string; email: string | null } | null }
  error: { code?: string } | null
}

function mockGetUser(result: GetUserResult): ReturnType<typeof vi.fn> {
  const getUser = vi.fn(async () => result)

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser },
  } as unknown as ServerClient)

  return getUser
}

function mockRoles(rows: unknown[] | null, error: { message: string } | null = null): void {
  // The last eq() is awaited, so the builder has to be thenable.
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[] | null; error: unknown }) => void) =>
      resolve({ data: rows, error }),
  }

  vi.mocked(getSupabaseAdminClient).mockReturnValue({
    from: vi.fn(() => builder),
  } as unknown as AdminClient)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getAuthUser", () => {
  it("returns the verified user", async () => {
    const getUser = mockGetUser({
      data: { user: { id: "user-1", email: "person@example.com" } },
      error: null,
    })

    await expect(getAuthUser()).resolves.toEqual({
      id: "user-1",
      email: "person@example.com",
    })
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it("keeps a null email as null", async () => {
    mockGetUser({ data: { user: { id: "user-1", email: null } }, error: null })

    await expect(getAuthUser()).resolves.toEqual({ id: "user-1", email: null })
  })

  it("returns null when there is no user", async () => {
    mockGetUser({ data: { user: null }, error: null })

    await expect(getAuthUser()).resolves.toBeNull()
  })

  it("returns null when verification fails", async () => {
    mockGetUser({
      data: { user: { id: "user-1", email: "person@example.com" } },
      error: { code: "bad_jwt" },
    })

    await expect(getAuthUser()).resolves.toBeNull()
  })
})

describe("getUserRoles", () => {
  it("returns the active roles", async () => {
    mockRoles([{ role: "affiliate" }, { role: "customer" }])

    await expect(getUserRoles("user-1")).resolves.toEqual(["affiliate", "customer"])
  })

  it("drops values that are not roles and duplicates", async () => {
    mockRoles([{ role: "admin" }, { role: "root" }, { role: "admin" }, { nope: 1 }, null, "admin"])

    await expect(getUserRoles("user-1")).resolves.toEqual(["admin"])
  })

  it("returns an empty list when the read fails", async () => {
    mockRoles(null, { message: "permission denied" })

    await expect(getUserRoles("user-1")).resolves.toEqual([])
  })

  it("does not query for an empty user id", async () => {
    mockRoles([{ role: "admin" }])

    await expect(getUserRoles("  ")).resolves.toEqual([])
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
  })
})
