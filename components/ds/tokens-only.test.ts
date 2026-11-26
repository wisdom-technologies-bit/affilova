import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

// Three rules, checked by reading the source.
//
//   1. A component names a token, never a colour. A hard-coded hex is how a
//      design system rots: one file keeps a #E3E6E3 after the token moves, and
//      nobody notices until a screenshot looks wrong.
//   2. No gradients. `linear-gradient`, `radial-gradient` and Tailwind's
//      `bg-gradient-*` are the house style of every competitor this product is
//      trying not to look like.
//   3. No emoji in rendered copy. An emoji in a financial product reads as a
//      marketing email, and it is read aloud by a screen reader as its name.
//
// What is scanned: app/ and components/, which is everything that renders. What
// is not: tests (they assert about colours), lib/ (the palette itself lives
// there, and so do email templates, which need literal colours to survive a mail
// client), and the style guide, which has to show a hex value to document a
// token.
//
// The check is deliberately literal: it is a guard against a habit, not a
// parser. Comments are skipped so a note about the rule cannot break it.

const ROOT = process.cwd()

const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "coverage"])

/** Files that are allowed a literal colour, each for a stated reason. */
const ALLOWED_HEX = new Map<string, string>([
  [
    "components/auth/google-button.tsx",
    "The Google sign-in mark must be drawn in Google's own four brand colours.",
  ],
])

/** Paths that are documentation of the system rather than a use of it. */
const NOT_SCANNED = ["app/hosts/admin/design", "components/design-guide"]

function walk(directory: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue
    }

    const path = join(directory, entry)
    const stats = statSync(path)

    if (stats.isDirectory()) {
      found.push(...walk(path))
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path)
    }
  }

  return found
}

const FILES = ["app", "components"]
  .flatMap((directory) => walk(join(ROOT, directory)))
  .map((path) => relative(ROOT, path).replaceAll("\\", "/"))
  .filter((path) => !NOT_SCANNED.some((prefix) => path.startsWith(prefix)))
  .sort()

/** The code on a line, with a trailing comment removed and whole-line comments skipped. */
function codeLines(source: string): { number: number; text: string }[] {
  const lines: { number: number; text: string }[] = []

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return
    }

    lines.push({ number: index + 1, text: line })
  })

  return lines
}

function findInFiles(pattern: RegExp): string[] {
  const hits: string[] = []

  for (const path of FILES) {
    const source = readFileSync(join(ROOT, path), "utf8")

    for (const line of codeLines(source)) {
      const match = pattern.exec(line.text)

      if (match !== null) {
        hits.push(`${path}:${line.number} ${match[0]}`)
      }

      pattern.lastIndex = 0
    }
  }

  return hits
}

const HEX = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g
const GRADIENT = /\b(?:linear-gradient|radial-gradient|conic-gradient)\b|\bbg-gradient-to-\w+|\bbg-linear-to-\w+/g
// Emoji proper: the pictographic blocks, the presentation selectors that force
// an emoji glyph, and the regional-indicator flags. Not the typographic symbols
// the product does use (· — … → ✓), which are text and are read as text.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{1F900}-\u{1F9FF}]/gu

describe("the source uses tokens, not colours", () => {
  it("scans the files that render", () => {
    // A guard on the guard: if the walk finds nothing, the test would pass for
    // the wrong reason.
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES).toContain("components/ui/button.tsx")
    expect(FILES).toContain("app/layout.tsx")
  })

  it("has no hard-coded hex colour in a component", () => {
    const hits = findInFiles(HEX).filter((hit) => {
      const path = hit.split(":")[0]

      return !ALLOWED_HEX.has(path)
    })

    expect(hits, "Use a token (bg-surface-subtle) or import one from lib/design/tokens.").toEqual([])
  })

  it("has no gradient", () => {
    expect(findInFiles(GRADIENT), "No gradients: separate things with a rule and space.").toEqual([])
  })

  it("has no emoji in rendered copy", () => {
    expect(findInFiles(EMOJI), "No emoji anywhere in the product.").toEqual([])
  })
})
