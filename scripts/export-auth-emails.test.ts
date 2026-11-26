import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { AUTH_EMAIL_OUTPUT_DIR, exportAuthEmails } from "./export-auth-emails"

// `pnpm emails:export` runs this file.
//
// The export itself is scripts/export-auth-emails.ts; this wrapper exists because
// the repository has no standalone TypeScript runner, and vitest already compiles
// TSX and resolves the "@/" alias. It is skipped in the ordinary suite so that
// `pnpm test` never rewrites a committed file: the files are exported on purpose,
// reviewed, and committed.
//
// What it checks after writing is what makes the export worth trusting: each file
// exists, and each still carries the Supabase variables it is supposed to carry.

const SHOULD_EXPORT = process.env.EMAILS_EXPORT === "1"

describe("emails:export", () => {
  it.skipIf(!SHOULD_EXPORT)("writes the four Supabase Auth templates", () => {
    const written = exportAuthEmails()

    expect(written.map((entry) => entry.file)).toEqual([
      "supabase-confirm-signup.html",
      "supabase-magic-link.html",
      "supabase-reset-password.html",
      "supabase-change-email.html",
    ])

    for (const entry of written) {
      const html = readFileSync(join(AUTH_EMAIL_OUTPUT_DIR, entry.file), "utf8")

      expect(html).toContain("{{ .SiteURL }}")
      expect(html).toContain("{{ .TokenHash }}")
      expect(html.startsWith("<!DOCTYPE html>")).toBe(true)
      expect(entry.bytes).toBeGreaterThan(0)
    }
  })
})
