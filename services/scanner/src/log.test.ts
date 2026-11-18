import { describe, expect, it } from "vitest"

import { createLogger, formatLifecycleLog, formatScanLog } from "#log"

const SCAN = {
  scanId: "6af469de-05d7-4ae1-9d69-b68600000001",
  fileId: "6af469de-05d7-4ae1-9d69-b68600000002",
  verdict: "clean",
  durationMs: 1234.6,
  stages: { download: 400.2, detect: 12.9, scan: 700 },
}

describe("formatScanLog", () => {
  it("emits one JSON object with the identifiers, verdict and durations", () => {
    const parsed: unknown = JSON.parse(formatScanLog(SCAN))

    expect(parsed).toEqual({
      level: "info",
      event: "scan.result",
      scanId: SCAN.scanId,
      fileId: SCAN.fileId,
      verdict: "clean",
      durationMs: 1235,
      stages: { download: 400, detect: 13, scan: 700 },
    })
  })

  it("carries no URL, path or file name", () => {
    const line = formatScanLog({ ...SCAN, stages: { download: 1 } })

    expect(line).not.toContain("http")
    expect(line).not.toContain(".zip")
    expect(line).not.toContain("/data")
  })

  it("drops stages that are not plain names or not finite", () => {
    const parsed = JSON.parse(
      formatScanLog({ ...SCAN, stages: { ok: 5, "bad-name": 1, "a b": 2, broken: Number.NaN } }),
    ) as { stages: Record<string, number> }

    expect(parsed.stages).toEqual({ ok: 5 })
  })

  it("never emits a negative duration", () => {
    const parsed = JSON.parse(formatScanLog({ ...SCAN, durationMs: -5, stages: {} })) as { durationMs: number }

    expect(parsed.durationMs).toBe(0)
  })

  it("survives without stages", () => {
    const parsed = JSON.parse(
      formatScanLog({ scanId: "a", fileId: "b", verdict: "error", durationMs: 1 }),
    ) as Record<string, unknown>

    expect(parsed.stages).toBeUndefined()
  })
})

describe("formatLifecycleLog", () => {
  it("keeps plain scalar fields", () => {
    const parsed: unknown = JSON.parse(formatLifecycleLog("scanner.start", { port: 8080, concurrency: 2 }))

    expect(parsed).toEqual({ level: "info", event: "scanner.start", port: 8080, concurrency: 2 })
  })

  it.each([
    "downloadUrl",
    "callbackUrl",
    "path",
    "workDir",
    "fileName",
    "content",
    "secret",
    "sharedSecret",
    "token",
    "body",
  ])("drops the %s field", (field) => {
    const parsed = JSON.parse(
      formatLifecycleLog("event", { [field]: "https://bucket.r2.cloudflarestorage.com/x.pdf" }),
    ) as Record<string, unknown>

    expect(parsed[field]).toBeUndefined()
  })

  it("truncates long strings", () => {
    const parsed = JSON.parse(formatLifecycleLog("event", { message: "x".repeat(200) })) as { message: string }

    expect(parsed.message).toHaveLength(80)
  })
})

describe("createLogger", () => {
  it("writes whole lines to the sink", () => {
    const lines: string[] = []
    const logger = createLogger((line: string) => {
      lines.push(line)
    })

    logger.scan(SCAN)
    logger.lifecycle("scanner.start", { port: 8080 })

    expect(lines).toHaveLength(2)
    expect(lines[0].endsWith("\n")).toBe(true)
    expect(lines[1].endsWith("\n")).toBe(true)

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })
})
