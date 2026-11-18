import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ScanQueue, prepareWorkDir } from "#queue"

const created: string[] = []

afterEach(async () => {
  while (created.length > 0) {
    const directory = created.pop()

    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

type Job = { readonly id: string }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()

  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("the queue did not reach the expected state in time")
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
}

describe("ScanQueue", () => {
  it("starts up to concurrency jobs immediately", async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>()
    const started: string[] = []

    const queue = new ScanQueue<Job>({
      concurrency: 2,
      limit: 10,
      worker: async (job: Job) => {
        started.push(job.id)
        const gate = deferred()
        gates.set(job.id, gate)
        await gate.promise
      },
    })

    expect(queue.tryEnqueue({ id: "a" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "b" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "c" })).toEqual({ accepted: true })

    await waitFor(() => started.length === 2)

    expect(started).toEqual(["a", "b"])
    expect(queue.activeCount).toBe(2)
    expect(queue.pendingCount).toBe(1)

    gates.get("a")?.resolve()

    await waitFor(() => started.length === 3)

    expect(started).toEqual(["a", "b", "c"])
    expect(queue.activeCount).toBe(2)
    expect(queue.pendingCount).toBe(0)

    gates.get("b")?.resolve()
    gates.get("c")?.resolve()
    await queue.drain()

    expect(queue.activeCount).toBe(0)
  })

  it("refuses work when the waiting list is full", async () => {
    const gate = deferred()

    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 2,
      worker: async () => {
        await gate.promise
      },
    })

    expect(queue.tryEnqueue({ id: "running" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "waiting-1" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "waiting-2" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "over" })).toEqual({ accepted: false, reason: "full" })

    gate.resolve()
    await queue.drain()
  })

  it("accepts work again once a slot frees up", async () => {
    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 1,
      worker: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5)
        })
      },
    })

    expect(queue.tryEnqueue({ id: "a" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "b" })).toEqual({ accepted: true })
    expect(queue.tryEnqueue({ id: "c" })).toEqual({ accepted: false, reason: "full" })

    await queue.drain()

    expect(queue.tryEnqueue({ id: "d" })).toEqual({ accepted: true })

    await queue.drain()

    expect(queue.activeCount).toBe(0)
  })

  it("refuses work once it is closing", async () => {
    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 5,
      worker: async () => undefined,
    })

    await queue.shutdown(1000)

    expect(queue.isClosing).toBe(true)
    expect(queue.tryEnqueue({ id: "late" })).toEqual({ accepted: false, reason: "closed" })
  })

  it("keeps running after a job throws and reports it", async () => {
    const failures: string[] = []
    let completed = 0

    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 5,
      worker: async (job: Job) => {
        if (job.id === "bad") {
          throw new Error("boom")
        }

        completed += 1
      },
      onError: (job: Job) => {
        failures.push(job.id)
      },
    })

    queue.tryEnqueue({ id: "bad" })
    queue.tryEnqueue({ id: "good" })
    await queue.drain()

    expect(failures).toEqual(["bad"])
    expect(completed).toBe(1)
  })

  it("drops waiting work and finishes running work on shutdown", async () => {
    const gate = deferred()
    let finished = 0

    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 5,
      worker: async () => {
        await gate.promise
        finished += 1
      },
    })

    queue.tryEnqueue({ id: "a" })
    queue.tryEnqueue({ id: "b" })
    queue.tryEnqueue({ id: "c" })

    const shutdown = queue.shutdown(2000)

    gate.resolve()

    expect(await shutdown).toEqual({ finished: true, dropped: 2 })
    expect(finished).toBe(1)
  })

  it("returns finished false when the grace period expires", async () => {
    const queue = new ScanQueue<Job>({
      concurrency: 1,
      limit: 5,
      worker: async () => {
        await new Promise<void>(() => {
          // Never settles: this mirrors a scan that is still running.
        })
      },
    })

    queue.tryEnqueue({ id: "stuck" })

    const result = await queue.shutdown(20)

    expect(result.finished).toBe(false)
    expect(result.dropped).toBe(0)
  })

  it("finishes immediately when nothing is running", async () => {
    const queue = new ScanQueue<Job>({ concurrency: 1, limit: 5, worker: async () => undefined })

    expect(await queue.shutdown(1000)).toEqual({ finished: true, dropped: 0 })
  })

  it("resolves drain immediately on an idle queue", async () => {
    const queue = new ScanQueue<Job>({ concurrency: 2, limit: 2, worker: async () => undefined })

    await expect(queue.drain()).resolves.toBeUndefined()
  })

  it("never runs more than concurrency jobs at once", async () => {
    let inFlight = 0
    let peak = 0

    const queue = new ScanQueue<number>({
      concurrency: 3,
      limit: 20,
      worker: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1)
        })
        inFlight -= 1
      },
    })

    for (let index = 0; index < 20; index += 1) {
      queue.tryEnqueue(index)
    }

    await queue.drain()

    expect(peak).toBe(3)
  })
})

describe("prepareWorkDir", () => {
  it("removes everything left behind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-work-"))
    created.push(directory)

    await writeFile(join(directory, "stale-file"), "x")
    await mkdir(join(directory, "stale-dir"))
    await writeFile(join(directory, "stale-dir", "nested"), "x")

    expect(await prepareWorkDir(directory)).toBe(2)
    expect(await readdir(directory)).toEqual([])
  })

  it("returns zero for a missing directory", async () => {
    expect(await prepareWorkDir(join(tmpdir(), "scanner-no-such-work-dir"))).toBe(0)
  })

  it("leaves an empty directory empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanner-work-"))
    created.push(directory)

    expect(await prepareWorkDir(directory)).toBe(0)
    expect(await readdir(directory)).toEqual([])
  })
})
