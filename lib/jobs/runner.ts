import { logger } from "@/lib/logger"
import type { JobHandler } from "./handlers"
import type { Job } from "./types"

// The queue functions the runner needs. The cron route passes the real ones;
// tests pass fakes, so this file never imports Supabase.
export type JobQueueFunctions = {
  claimJobs: (batch: number) => Promise<Job[]>
  completeJob: (id: string) => Promise<void>
  failJob: (id: string, errorText: string) => Promise<void>
  releaseJob: (id: string) => Promise<void>
}

export type HandlerLookup = {
  get: (type: string) => JobHandler | undefined
}

export type ProcessQueueInput = {
  queue: JobQueueFunctions
  handlers: HandlerLookup
  batch?: number
  budgetMs?: number
  perJobTimeoutMs?: number
}

export type ProcessQueueResult = {
  claimed: number
  completed: number
  failed: number
  released: number
}

// An error message stored on a job is a hint for whoever reads the queue, not a
// stack trace.
const MAX_MESSAGE_LENGTH = 200

class HandlerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Handler timed out after ${timeoutMs}ms`)
    this.name = "HandlerTimeoutError"
  }
}

function shortMessage(error: unknown): string {
  if (error instanceof HandlerTimeoutError) {
    return error.message
  }

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim().slice(0, MAX_MESSAGE_LENGTH)
  }

  return "Handler failed"
}

// Races the handler against a timer. The timer is always cleared, so a fast
// handler leaves nothing behind for the process to wait on.
function runWithTimeout(work: () => Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      callback()
    }

    const timer = setTimeout(() => {
      settle(() => reject(new HandlerTimeoutError(timeoutMs)))
    }, timeoutMs)

    try {
      work().then(
        () => settle(resolve),
        (error: unknown) => settle(() => reject(error)),
      )
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

async function releaseQuietly(queue: JobQueueFunctions, id: string): Promise<boolean> {
  try {
    await queue.releaseJob(id)
    return true
  } catch {
    return false
  }
}

/**
 * One cron run: claim a small batch, run what fits in the time budget, and stop.
 *
 * A job is released (not failed) when the run has less time left than one job is
 * allowed, so it keeps its attempts and is picked up by the next run.
 */
export async function runProcessQueue(input: ProcessQueueInput): Promise<ProcessQueueResult> {
  const {
    queue,
    handlers,
    batch = 10,
    budgetMs = 18000,
    perJobTimeoutMs = 8000,
  } = input

  const startedAt = Date.now()
  const result: ProcessQueueResult = { claimed: 0, completed: 0, failed: 0, released: 0 }

  const jobs = await queue.claimJobs(batch)
  result.claimed = jobs.length

  for (let index = 0; index < jobs.length; index += 1) {
    const remainingMs = budgetMs - (Date.now() - startedAt)

    // Too little time left to give this job its full timeout: hand this job and
    // every one after it back to the queue untouched.
    if (remainingMs < perJobTimeoutMs) {
      for (const leftover of jobs.slice(index)) {
        if (await releaseQuietly(queue, leftover.id)) {
          result.released += 1
        }
      }

      break
    }

    const job = jobs[index]
    const handler = handlers.get(job.type)

    if (!handler) {
      logger.error("job_failed", { type: job.type, reason: "unknown job type" })

      try {
        await queue.failJob(job.id, `Unknown job type: ${job.type}`)
      } catch {
        // Bookkeeping failed; the lock timeout will bring the job back.
      }

      result.failed += 1
      continue
    }

    try {
      await runWithTimeout(() => handler(job), perJobTimeoutMs)
    } catch (error) {
      logger.error("job_failed", { type: job.type, reason: shortMessage(error) })

      try {
        await queue.failJob(job.id, shortMessage(error))
      } catch {
        // Bookkeeping failed; the lock timeout will bring the job back.
      }

      result.failed += 1
      continue
    }

    try {
      await queue.completeJob(job.id)
      result.completed += 1
    } catch {
      // The work ran but could not be recorded as done. Counted as failed rather
      // than completed; the lock expires and the job runs again.
      result.failed += 1
    }
  }

  return result
}
