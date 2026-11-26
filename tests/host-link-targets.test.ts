import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

// A link may never carry the internal shell prefix.
//
// The app hosts serve "/users" out of "app/hosts/admin/users", and the
// middleware rewrites the visible path to "/hosts/admin/users" behind the
// browser's back. A link written as "/hosts/admin/users" therefore looks right
// in the source and 404s in production: the internal tree is never reachable by
// URL, on any host. See docs/host-routing.md.
//
// This test reads the source of app/, components/ and lib/ and fails on any
// string or template literal starting with "/hosts/" that is used as a link
// target. It goes through the TypeScript parser rather than a text search, so a
// path mentioned in a comment cannot fail the build and a path assembled in a
// helper function still can.

const ROOT = fileURLToPath(new URL("../", import.meta.url))

/** The trees a link target can live in. */
const SCANNED_DIRECTORIES = ["app", "components", "lib"] as const

/** lib/host-routing.ts is the one file that is about the prefix itself. */
const EXCLUDED_FILES = new Set(["lib/host-routing.ts"])

const SOURCE_FILE = /\.(?:ts|tsx)$/
const TEST_FILE = /\.test\.(?:ts|tsx)$/

const PREFIX = "/hosts/"

/** Calls whose argument is a path the router itself resolves. */
const ALLOWED_CALLS = new Set(["revalidatePath", "revalidateTag"])

export type Finding = {
  /** Path relative to the repository root, with forward slashes. */
  file: string
  /** One-based line number. */
  line: number
  /** The literal as written, cut to a readable length. */
  literal: string
  /** How the literal is reached, or "unattached" when it is neither. */
  how: string
}

function walk(directory: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") {
        continue
      }

      found.push(...walk(full))
      continue
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      found.push(full)
    }
  }

  return found
}

function parentsOf(sourceFile: ts.SourceFile): Map<ts.Node, ts.Node> {
  const parents = new Map<ts.Node, ts.Node>()

  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, (child) => {
      parents.set(child, node)
      visit(child)
    })
  }

  visit(sourceFile)

  return parents
}

/** The leading text of a string or template literal, or null. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  if (ts.isTemplateExpression(node)) {
    return node.head.text
  }

  return null
}

function isNamedJsxAttribute(node: ts.Node, names: readonly string[]): boolean {
  return ts.isJsxAttribute(node) && names.includes(node.name.getText())
}

/**
 * The call the literal is an argument of, when it is one.
 *
 * Only a direct argument counts: a literal returned from a helper is not
 * attributed to the helper's caller here, which is why the callers below treat
 * an unattached literal as a finding rather than as fine.
 */
function enclosingCall(node: ts.Node, parents: Map<ts.Node, ts.Node>): string | null {
  let current: ts.Node | undefined = node

  while (current !== undefined) {
    const parent: ts.Node | undefined = parents.get(current)

    if (parent === undefined) {
      return null
    }

    if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === current)) {
      const callee = parent.expression

      if (ts.isIdentifier(callee)) {
        return callee.text
      }

      if (ts.isPropertyAccessExpression(callee)) {
        return callee.getText()
      }

      return "call"
    }

    current = parent
  }

  return null
}

/** How a literal is used, when it is used as a link target. */
function linkTarget(node: ts.Node, parents: Map<ts.Node, ts.Node>): string | null {
  let current: ts.Node = node

  while (parents.has(current)) {
    const parent = parents.get(current) as ts.Node

    if (isNamedJsxAttribute(parent, ["href"])) {
      return "href"
    }

    if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === current)) {
      const callee = parent.expression

      if (ts.isIdentifier(callee) && callee.text === "redirect") {
        return "redirect"
      }

      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "router" &&
        (callee.name.text === "push" || callee.name.text === "replace")
      ) {
        return `router.${callee.name.text}`
      }
    }

    current = parent
  }

  return null
}

/** Every offending literal in one file's source. */
export function findHostLinkTargets(file: string, source: string): Finding[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const parents = parentsOf(sourceFile)
  const findings: Finding[] = []

  const visit = (node: ts.Node): void => {
    const text = literalText(node)

    if (text !== null && text.startsWith(PREFIX)) {
      const target = linkTarget(node, parents)
      const call = enclosingCall(node, parents)
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))

      findings.push({
        file,
        line: position.line + 1,
        literal: text.length > 60 ? `${text.slice(0, 60)}…` : text,
        how: target ?? call ?? "unattached",
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return findings
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/")
}

function scanRepository(): Finding[] {
  const findings: Finding[] = []

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of walk(path.join(ROOT, directory))) {
      const name = relative(file)

      if (EXCLUDED_FILES.has(name)) {
        continue
      }

      findings.push(...findHostLinkTargets(name, readFileSync(file, "utf8")))
    }
  }

  return findings
}

/** Findings that break the rule: a link target, or a stray literal. */
function violations(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => {
    const allowedCall = ALLOWED_CALLS.has(finding.how)
    const isLibrary = finding.file.startsWith("lib/")

    // lib/ may name the internal tree to revalidate a route that lives there.
    // Anywhere else, a "/hosts/" literal has no reason to exist: in a page or a
    // component it is a link target, whether or not the parser can see the call
    // that consumes it.
    return isLibrary ? !allowedCall : true
  })
}

function printable(findings: readonly Finding[]): string {
  return findings
    .map((finding) => `${finding.file}:${finding.line} ${finding.literal} (${finding.how})`)
    .join("\n")
}

describe("host-relative link targets", () => {
  it("never writes a link target that starts with /hosts/", () => {
    const bad = violations(scanRepository())

    expect(bad, `Link targets must be host-relative:\n${printable(bad)}`).toEqual([])
  })

  it("scans the three trees that can hold a link", () => {
    const files = SCANNED_DIRECTORIES.flatMap((directory) => walk(path.join(ROOT, directory)))

    // A guard against a broken walk: the trees are not empty.
    expect(files.length).toBeGreaterThan(200)
  })

  it("flags every shape the rule covers", () => {
    const source = [
      'const a = <Link href="/hosts/admin/users">Users</Link>',
      'const b = () => redirect("/hosts/merchant")',
      'router.push("/hosts/affiliate/earnings")',
      'router.replace(`/hosts/merchant/products/${id}`)',
      'const c = <a href={"/hosts/admin"}>Admin</a>',
    ].join("\n")

    const findings = findHostLinkTargets("app/example/page.tsx", source)

    expect(findings.map((finding) => finding.how)).toEqual([
      "href",
      "redirect",
      "router.push",
      "router.replace",
      "href",
    ])
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3, 4, 5])
  })

  it("flags a path assembled in a helper, which is how this bug got in", () => {
    const source = [
      "function hrefWith(page: number): string {",
      '  return page > 1 ? `/hosts/admin/users?page=${page}` : "/hosts/admin/users"',
      "}",
    ].join("\n")

    const findings = violations(findHostLinkTargets("app/hosts/admin/users/page.tsx", source))

    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.how === "unattached")).toBe(true)
  })

  it("ignores the prefix in a comment, in lib/host-routing.ts and in revalidatePath", () => {
    const commented = [
      "// The middleware rewrites /products to /hosts/merchant/products.",
      'const label = "the internal tree"',
    ].join("\n")

    expect(findHostLinkTargets("components/example.tsx", commented)).toEqual([])

    const revalidate = 'revalidatePath("/hosts/admin/users")'

    expect(violations(findHostLinkTargets("lib/admin/users-actions.ts", revalidate))).toEqual([])
    expect(violations(findHostLinkTargets("app/hosts/admin/users/page.tsx", revalidate))).toHaveLength(1)
  })
})
