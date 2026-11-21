import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { LEGAL_DOCUMENTS, documentToPlain } from "@/content/legal"
import { POLICY_VERSIONS, legalIdentityLine } from "@/lib/site-config"

const FORBIDDEN_HARDCODED_FIGURES = ["10%", "7 days", "24 hours", "₦5,000"] as const

describe("legal documents content", () => {
  it("exports all nine documents with matching versions, unique slugs/hrefs and 5-bullet summaries", () => {
    expect(LEGAL_DOCUMENTS).toHaveLength(9)

    const slugs = new Set<string>()
    const hrefs = new Set<string>()
    const keys = new Set<string>()

    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.title.trim().length).toBeGreaterThan(0)
      expect(doc.description.trim().length).toBeGreaterThan(0)
      expect(doc.effectiveDate).toBe("2026-11-21")
      expect(doc.version).toBe(POLICY_VERSIONS[doc.key])
      expect(doc.summary).toHaveLength(5)
      for (const bullet of doc.summary) {
        expect(bullet.trim().length).toBeGreaterThan(0)
      }

      expect(doc.sections.length).toBeGreaterThan(0)
      const sectionIds = new Set<string>()
      for (const section of doc.sections) {
        expect(section.id).toMatch(/^[a-z0-9-]+$/)
        expect(sectionIds.has(section.id)).toBe(false)
        sectionIds.add(section.id)
        expect(section.blocks.length).toBeGreaterThan(0)
      }

      expect(slugs.has(doc.slug)).toBe(false)
      expect(hrefs.has(doc.href)).toBe(false)
      expect(keys.has(doc.key)).toBe(false)
      slugs.add(doc.slug)
      hrefs.add(doc.href)
      keys.add(doc.key)
    }

    expect(keys.size).toBe(Object.keys(POLICY_VERSIONS).length)
  })

  it("contains no HTML, markdown syntax or placeholder tokens in rendered plain text", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const plain = documentToPlain(doc)
      expect(plain).not.toMatch(/<[a-z][^>]*>/i)
      expect(plain).not.toMatch(/\*\*/)
      expect(plain).not.toMatch(/^#{1,6}\s/m)
      expect(plain).not.toMatch(/\[[^\]]+\]\([^)]+\)/)
      expect(plain).not.toMatch(/\b(TODO|TBD)\b/i)
      expect(plain).not.toMatch(/\[[^\]]+\]/)
    }
  })

  it("never hard-codes configurable fee, hold, refund or withdrawal numbers in content/legal or HowItWorksClient", () => {
    const contentDir = join(process.cwd(), "content", "legal")
    const files = readdirSync(contentDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(contentDir, name))

    files.push(join(process.cwd(), "app", "how-it-works", "HowItWorksClient.tsx"))

    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8")
      for (const literal of FORBIDDEN_HARDCODED_FIGURES) {
        expect(source, `${filePath} must template "${literal}" from lib/site-config.ts`).not.toContain(
          literal,
        )
      }
    }
  })
})

describe("legalIdentityLine", () => {
  it("returns an empty string when entityName is empty", () => {
    expect(
      legalIdentityLine({
        entityName: "",
        registeredAddress: "12 Marina, Lagos",
        registrationNumber: "RC-12345",
      }),
    ).toBe("")
  })

  it("includes only the populated parts when entityName is set", () => {
    expect(
      legalIdentityLine({
        entityName: "Affilova Limited",
        registeredAddress: "",
        registrationNumber: "",
      }),
    ).toBe("Affilova is operated by Affilova Limited")

    expect(
      legalIdentityLine({
        entityName: "Affilova Limited",
        registeredAddress: "12 Marina, Lagos",
        registrationNumber: "",
      }),
    ).toBe("Affilova is operated by Affilova Limited, 12 Marina, Lagos")

    expect(
      legalIdentityLine({
        entityName: "Affilova Limited",
        registeredAddress: "12 Marina, Lagos",
        registrationNumber: "RC-123456",
      }),
    ).toBe("Affilova is operated by Affilova Limited, 12 Marina, Lagos (registration no. RC-123456)")
  })
})
