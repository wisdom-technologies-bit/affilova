import { describe, expect, it, vi } from "vitest"

import type { JobHandler } from "./handlers"
import { runProcessQueue, type HandlerLookup, type JobQueueFunctions } from "./runner"
import type { Job } from "./types"

const ISO = "2026-11-12T09:00:00.000Z"

function makeJob(id: string, type = "noop"): Job {
  return {
    id,
    type,
    payload: {},
    status: "running",
    attempts: 1,
    max_attempts: 8,
    run_at: ISO,
    locked_at: ISO,
    last_error: null,
    dedupe_key: null,
    created_at: ISO,
    updated_at: ISO,
  }
}

type QueueHarness = {
  queue: JobQueueFunctions
  claimJobs: ReturnType<typeof vi.fn>
  completeJob: ReturnType<typeof vi.fn>
  failJob: ReturnType<typeof vi.fn>
  releaseJob: ReturnType<typeof vi.fn>
}

function makeQueue(jobs: Job[]): QueueHarness {
  const claimJobs = vi.fn(async (_batch: number) => jobs)
  const completeJob = vi.fn(async (_id: string) => undefined)
  const failJob = vi.fn(async (_id: string, _errorText: string) => undefined)
  const releaseJob = vi.fn(async (_id: string) => undefined)

  return {
    queue: { claimJobs, completeJob, failJob, releaseJob },
    claimJobs,
    completeJob,
    failJob,
    releaseJob,
  }
}

function makeHandlers(entries: Record<string, JobHandler>): HandlerLookup {
  return { get: (type: string) => entries[type] }
}

describe("runProcessQueue", () => {
  it("runs every claimed job and completes each one", async () => {
    const harness = makeQueue([makeJob("a"), makeJob("b"), makeJob("c")])
    const handler = vi.fn(async (_job: Job) => undefined)

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: handler }),
      budgetMs: 5000,
      perJobTimeoutMs: 2000,
    })

    expect(result).toEqual({ claimed: 3, completed: 3, failed: 0, released: 0 })
    expect(harness.claimJobs).toHaveBeenCalledWith(10)
    expect(handler).toHaveBeenCalledTimes(3)
    expect(harness.completeJob.mock.calls.map((call) => call[0])).toEqual(["a", "b", "c"])
    expect(harness.failJob).not.toHaveBeenCalled()
    expect(harness.releaseJob).not.toHaveBeenCalled()
  })

  it("fails a job whose handler throws, and keeps going", async () => {
    const harness = makeQueue([makeJob("bad"), makeJob("good")])

    const handler: JobHandler = async (job) => {
      if (job.id === "bad") {
        throw new Error("provider returned 500")
      }
    }

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: handler }),
      budgetMs: 5000,
      perJobTimeoutMs: 2000,
    })

    expect(result).toEqual({ claimed: 2, completed: 1, failed: 1, released: 0 })
    expect(harness.failJob).toHaveBeenCalledTimes(1)
    expect(harness.failJob).toHaveBeenCalledWith("bad", "provider returned 500")
    expect(harness.completeJob).toHaveBeenCalledWith("good")
  })

  it("fails a job whose type has no handler registered", async () => {
    const harness = makeQueue([makeJob("x", "mystery")])
    const handler = vi.fn(async (_job: Job) => undefined)

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: handler }),
      budgetMs: 5000,
      perJobTimeoutMs: 2000,
    })

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1, released: 0 })
    expect(handler).not.toHaveBeenCalled()
    expect(harness.failJob).toHaveBeenCalledWith("x", "Unknown job type: mystery")
    expect(harness.completeJob).not.toHaveBeenCalled()
  })

  it("fails a job whose handler never finishes", async () => {
    const harness = makeQueue([makeJob("slow")])
    const hanging: JobHandler = () => new Promise<void>(() => {})

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: hanging }),
      budgetMs: 5000,
      perJobTimeoutMs: 25,
    })

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1, released: 0 })
    expect(harness.failJob).toHaveBeenCalledWith("slow", "Handler timed out after 25ms")
    expect(harness.completeJob).not.toHaveBeenCalled()
  })

  it("releases every job when there is no budget left to run one", async () => {
    const harness = makeQueue([makeJob("a"), makeJob("b")])
    const handler = vi.fn(async (_job: Job) => undefined)

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: handler }),
      budgetMs: 10,
      perJobTimeoutMs: 50,
    })

    expect(result).toEqual({ claimed: 2, completed: 0, failed: 0, released: 2 })
    expect(handler).not.toHaveBeenCalled()
    expect(harness.releaseJob.mock.calls.map((call) => call[0])).toEqual(["a", "b"])
    expect(harness.completeJob).not.toHaveBeenCalled()
    expect(harness.failJob).not.toHaveBeenCalled()
  })

  it("releases the remaining jobs once the budget runs out mid-batch", async () => {
    const harness = makeQueue([makeJob("a"), makeJob("b")])
    const handler: JobHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({ noop: handler }),
      budgetMs: 25,
      perJobTimeoutMs: 20,
    })

    expect(result).toEqual({ claimed: 2, completed: 1, failed: 0, released: 1 })
    expect(harness.completeJob).toHaveBeenCalledWith("a")
    expect(harness.releaseJob).toHaveBeenCalledWith("b")
  })

  it("counts an empty claim as nothing to do", async () => {
    const harness = makeQueue([])

    const result = await runProcessQueue({
      queue: harness.queue,
      handlers: makeHandlers({}),
    })

    expect(result).toEqual({ claimed: 0, completed: 0, failed: 0, released: 0 })
    expect(harness.claimJobs).toHaveBeenCalledWith(10)
  })
})
