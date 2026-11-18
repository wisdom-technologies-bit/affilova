import { describe, expect, it } from "vitest"

import { runCommand } from "#exec"

const NODE = process.execPath

describe("runCommand", () => {
  it("runs a command with an argument array and captures stdout", async () => {
    const result = await runCommand(NODE, ["-e", "process.stdout.write('hello')"], { timeoutMs: 10_000 })

    expect(result.code).toBe(0)
    expect(result.stdout).toBe("hello")
    expect(result.timedOut).toBe(false)
  })

  it("reports a non zero exit code without throwing", async () => {
    const result = await runCommand(NODE, ["-e", "process.exit(3)"], { timeoutMs: 10_000 })

    expect(result.code).toBe(3)
    expect(result.timedOut).toBe(false)
  })

  it("captures stderr", async () => {
    const result = await runCommand(NODE, ["-e", "process.stderr.write('bad thing'); process.exit(2)"], {
      timeoutMs: 10_000,
    })

    expect(result.code).toBe(2)
    expect(result.stderr).toBe("bad thing")
  })

  it("does not let shell syntax in an argument run", async () => {
    const hostile = "; touch /tmp/exec-test-should-not-exist; echo $HOME `id`"

    const result = await runCommand(
      NODE,
      ["-e", "process.stdout.write(process.argv[1] ?? '')", hostile],
      { timeoutMs: 10_000 },
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(hostile)
  })

  it("kills a child that outlives its timeout", async () => {
    const started = Date.now()

    const result = await runCommand(NODE, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 100 })

    expect(result.timedOut).toBe(true)
    expect(result.code).toBeNull()
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it("resolves instead of rejecting when the binary is missing", async () => {
    const result = await runCommand("clamdscan-definitely-not-installed", ["--version"], { timeoutMs: 5000 })

    expect(result.code).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.stderr).not.toBe("")
  })

  it("caps captured output", async () => {
    const script = "for (let i = 0; i < 2000; i += 1) process.stdout.write('x'.repeat(1000))"

    const result = await runCommand(NODE, ["-e", script], { timeoutMs: 20_000, maxOutputBytes: 4096 })

    expect(result.code).toBe(0)
    expect(result.stdout.length).toBeLessThan(20_000)
  })
})
