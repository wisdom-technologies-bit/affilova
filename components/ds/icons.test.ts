import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"

import { Copy, ICON_SIZE, WarningCircle } from "./icons"

// The icon rules, as tests.
//
// Three things this file protects, and each one is a rule the design system
// states rather than a snapshot of today's markup:
//
//  1. lucide-react is gone and stays gone. One import is enough to fail.
//  2. Phosphor is imported by name, from its own per-icon module. A wildcard
//     import, or the package barrel, would put the whole set in every bundle.
//  3. An icon-only control has a name. The source is scanned for a `<button>`
//     whose children are only icons, and the design system's Button is rendered
//     to prove the name reaches the DOM.

const ROOT = process.cwd()
const SOURCE_DIRS = ["app", "components", "lib", "hooks"]

function sourceFiles(): string[] {
  const files: string[] = []

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stats = statSync(path)

      if (stats.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === ".git") {
          continue
        }
        walk(path)
        continue
      }

      if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
        files.push(path)
      }
    }
  }

  for (const dir of SOURCE_DIRS) {
    walk(join(ROOT, dir))
  }

  return files
}

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function relativePath(path: string): string {
  return relative(ROOT, path)
}

// Every `<button …>` or `<Button …>` in a file, with the children it was given.
interface ButtonSite {
  file: string
  line: number
  openTag: string
  children: string
}

function buttonSites(path: string, source: string): ButtonSite[] {
  const sites: ButtonSite[] = []
  const pattern = /<(button|Button)\b/g
  let match = pattern.exec(source)

  while (match !== null) {
    const start = match.index
    const line = source.slice(0, start).split("\n").length

    // The open tag ends at the first `>` that is not inside a brace group.
    let index = start + match[0].length
    let depth = 0
    let openEnd = -1

    while (index < source.length) {
      const char = source[index]

      if (char === "{") {
        depth += 1
      } else if (char === "}") {
        depth -= 1
      } else if (char === ">" && depth === 0) {
        openEnd = index
        break
      }

      index += 1
    }

    if (openEnd === -1) {
      match = pattern.exec(source)
      continue
    }

    const openTag = source.slice(start, openEnd + 1)
    const selfClosing = openTag.trimEnd().endsWith("/>")

    let children = ""

    if (!selfClosing) {
      const closing = `</${match[1]}>`
      const closeAt = source.indexOf(closing, openEnd)

      if (closeAt !== -1) {
        children = source.slice(openEnd + 1, closeAt)
      }
    }

    sites.push({ file: relativePath(path), line, openTag, children })
    match = pattern.exec(source)
  }

  return sites
}

// A control has a name when it declares one, or when a screen reader can read
// text inside it. Text inside `sr-only` counts; an icon does not.
function hasAccessibleName(site: ButtonSite): boolean {
  if (/\baria-label(ledby)?\s*=/.test(site.openTag)) {
    return true
  }

  if (site.children.trim() === "") {
    return false
  }

  // Strip JSX comments and element tags; whatever is left is text.
  const text = site.children
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return text !== ""
}

function isIconOnly(site: ButtonSite): boolean {
  if (/\btext-(small|dense|caption|body)\b/.test(site.children)) {
    return false
  }

  const child = site.children.trim()

  return /^<[A-Z][A-Za-z0-9]*\s[^>]*\/>$/.test(child) || /^<[A-Z][A-Za-z0-9]*\s*\/>$/.test(child)
}

describe("the icon set", () => {
  it("imports nothing from lucide-react", () => {
    const offenders = sourceFiles()
      .filter((path) => /from\s*["']lucide-react["']/.test(read(path)))
      .map(relativePath)

    expect(offenders).toEqual([])
  })

  it("imports Phosphor by name, never with a wildcard or the package barrel", () => {
    const offenders: string[] = []

    for (const path of sourceFiles()) {
      const source = read(path)

      if (!source.includes("@phosphor-icons/react")) {
        continue
      }

      const lines = source.split("\n")

      lines.forEach((line, index) => {
        if (/import\s+\*\s+as/.test(line) && line.includes("@phosphor-icons/react")) {
          offenders.push(`${relativePath(path)}:${index + 1} wildcard import`)
        }

        // The barrel and the client entry are both off limits: the first ships
        // 1500 icons, the second is a client-only module.
        if (
          /from\s*["']@phosphor-icons\/react(?:\/ssr|\/dist\/ssr)?["']/.test(line) &&
          !/^import\s+type\b/.test(line.trim())
        ) {
          offenders.push(`${relativePath(path)}:${index + 1} barrel import`)
        }
      })
    }

    expect(offenders).toEqual([])
  })

  it("imports every icon from its own module inside the set", () => {
    const source = read(join(ROOT, "components/ds/icons.ts"))
    const valueImports = source
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
      .filter((line) => line.includes("@phosphor-icons/react"))

    expect(valueImports.length).toBeGreaterThan(0)

    for (const line of valueImports) {
      expect(line).toMatch(/from "@phosphor-icons\/react\/dist\/ssr\/[A-Za-z]+"$/)
    }
  })

  it("sizes an icon from the three tokens only", () => {
    expect(ICON_SIZE).toEqual({ sm: 16, md: 20, lg: 24 })
  })
})

describe("an icon is never the only carrier of meaning", () => {
  it("finds an icon-only button with no name in the source", () => {
    const offenders: string[] = []

    for (const path of sourceFiles()) {
      if (path.endsWith(".test.ts")) {
        continue
      }

      for (const site of buttonSites(path, read(path))) {
        if (isIconOnly(site) && !hasAccessibleName(site)) {
          offenders.push(`${site.file}:${site.line} ${site.openTag.split("\n")[0].slice(0, 70)}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("renders the design system button with the name it was given", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { size: "icon", "aria-label": "Copy tracking link" }, createElement(Copy)),
    )

    expect(markup).toContain('aria-label="Copy tracking link"')
    // The icon itself stays decorative, so the name is not announced twice.
    expect(markup).toContain('aria-hidden="true"')
  })

  it("reports an icon-only button with no name as a violation", () => {
    // The detector is exercised on a tree it must reject, so a rule that stops
    // working cannot pass silently.
    const site = buttonSites("probe.tsx", "<button><Copy /></button>")[0]

    expect(isIconOnly(site)).toBe(true)
    expect(hasAccessibleName(site)).toBe(false)

    const labelled = buttonSites("probe.tsx", '<button aria-label="Copy"><Copy /></button>')[0]

    expect(hasAccessibleName(labelled)).toBe(true)
  })

  it("marks a status icon filled and keeps it decorative by default", () => {
    const markup = renderToStaticMarkup(createElement(WarningCircle, { tone: "danger" }))

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('fill="currentColor"')
  })
})
