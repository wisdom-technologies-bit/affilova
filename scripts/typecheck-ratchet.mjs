#!/usr/bin/env node
// Typecheck ratchet: keeps the number of TypeScript errors from growing.
//
// Runs `tsc --noEmit`, counts the lines mentioning "error TS" and compares the
// count against .github/typecheck-baseline.json ({"errors": N}).
//
// Exit codes:
//   0  the count is at or below the baseline (progress is reported)
//   1  the count is above the baseline, or the typecheck could not run
//
// Usage:
//   node scripts/typecheck-ratchet.mjs            # verify
//   node scripts/typecheck-ratchet.mjs --update   # rewrite the baseline

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const baselinePath = join(repoRoot, ".github", "typecheck-baseline.json")
const updateBaseline = process.argv.includes("--update")

function findTsc() {
  const localTsc = join(repoRoot, "node_modules", ".bin", "tsc")
  return existsSync(localTsc) ? localTsc : "tsc"
}

function runTypecheck() {
  const result = spawnSync(findTsc(), ["--noEmit"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) {
    console.error(`typecheck-ratchet: could not run tsc: ${result.error.message}`)
    process.exit(1)
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const errorLines = output
    .split(/\r?\n/)
    .filter((line) => line.includes("error TS"))

  return { output, errorLines }
}

function readBaseline() {
  if (!existsSync(baselinePath)) {
    return null
  }

  const parsed = JSON.parse(readFileSync(baselinePath, "utf8"))

  if (typeof parsed.errors !== "number" || !Number.isInteger(parsed.errors)) {
    throw new Error(`${baselinePath} must contain an integer "errors" field`)
  }

  return parsed.errors
}

function writeBaseline(count) {
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, `${JSON.stringify({ errors: count }, null, 2)}\n`)
}

const { output, errorLines } = runTypecheck()
const count = errorLines.length

if (updateBaseline) {
  writeBaseline(count)
  console.log(`typecheck-ratchet: baseline updated to ${count} error(s)`)
  process.exit(0)
}

const baseline = readBaseline()

if (baseline === null) {
  console.error(
    `typecheck-ratchet: ${baselinePath} is missing. Run "node scripts/typecheck-ratchet.mjs --update" to create it.`,
  )
  process.exit(1)
}

if (count > baseline) {
  console.error(output.trimEnd())
  console.error("")
  console.error(
    `typecheck-ratchet: ${count} TypeScript error(s), baseline is ${baseline} (+${count - baseline}). Fix the new errors above.`,
  )
  process.exit(1)
}

if (count < baseline) {
  console.log(
    `typecheck-ratchet: ${count} TypeScript error(s), baseline is ${baseline} (-${baseline - count}). Run "node scripts/typecheck-ratchet.mjs --update" to lower the baseline.`,
  )
  process.exit(0)
}

console.log(`typecheck-ratchet: ${count} TypeScript error(s), matching the baseline.`)
