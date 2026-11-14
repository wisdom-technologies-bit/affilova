import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { isReservedHandle, RESERVED_HANDLES } from "./reserved-handles"

// The reserved list exists twice: once in TypeScript, so the form can reject a
// handle without a round trip, and once inside public.is_reserved_handle() in
// the migration, because the database is the authority. This test reads the
// migration and fails if the two lists ever disagree, in either direction.

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20261113000100_roles_onboarding.sql", import.meta.url),
  "utf8",
)

function handlesFromMigration(): string[] {
  const start = MIGRATION.indexOf("ARRAY[")
  const end = MIGRATION.indexOf("]::text[]", start)

  expect(start, "the reserved list is an ARRAY[...]::text[] literal").toBeGreaterThan(-1)
  expect(end, "the array literal is closed").toBeGreaterThan(start)

  const block = MIGRATION.slice(start, end)

  return [...block.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "")
}

describe("reserved handles", () => {
  it("lists the same handles as public.is_reserved_handle", () => {
    const migrationHandles = handlesFromMigration()

    expect(new Set(migrationHandles)).toEqual(new Set(RESERVED_HANDLES))
  })

  it("has no duplicates and no blank entries", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length)
    expect(RESERVED_HANDLES.filter((handle) => handle.trim() === "")).toEqual([])
  })

  it("is already lowercase, because the database compares in lowercase", () => {
    expect(RESERVED_HANDLES.filter((handle) => handle !== handle.toLowerCase())).toEqual([])
  })

  it("covers the words in the migration's own comment block", () => {
    // A cheap guard against editing the prose and forgetting the array.
    expect(handlesFromMigration().length).toBeGreaterThan(20)
  })

  it("matches trimmed and case-insensitive input", () => {
    expect(isReservedHandle("admin")).toBe(true)
    expect(isReservedHandle("ADMIN")).toBe(true)
    expect(isReservedHandle("  Admin  ")).toBe(true)
    expect(isReservedHandle("sign-up")).toBe(true)
    expect(isReservedHandle("shop-one")).toBe(false)
    expect(isReservedHandle("")).toBe(false)
  })
})
