/**
 * Spawning child processes without a shell.
 *
 * Commands and arguments are always passed as an array, so a file path or a
 * signature name can never be reinterpreted as shell syntax. Output is capped and
 * the child is killed if it outlives its timeout.
 */

import { spawn } from "node:child_process"

export type CommandResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type RunCommandOptions = {
  readonly timeoutMs: number
  readonly maxOutputBytes?: number
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: RunCommandOptions,
) => Promise<CommandResult>

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/**
 * Runs `command` with an argument array and resolves with its exit code and
 * captured output. A timeout kills the child and sets `timedOut`; a spawn
 * failure resolves with `code: null` instead of rejecting.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  return new Promise<CommandResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false

    const finish = (code: number | null): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }

    const child = spawn(command, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, options.timeoutMs)

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8")

      if (target === "stdout") {
        if (stdout.length < maxOutputBytes) {
          stdout += text
        }
        return
      }

      if (stderr.length < maxOutputBytes) {
        stderr += text
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      append("stdout", chunk)
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      append("stderr", chunk)
    })

    child.once("error", (error: Error) => {
      stderr = error.message
      finish(null)
    })

    child.once("close", (code: number | null) => {
      finish(code)
    })
  })
}
