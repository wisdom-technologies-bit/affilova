/**
 * Bounded in-memory work queue.
 *
 * `concurrency` jobs run at once and up to `limit` wait behind them; anything
 * beyond that is refused so the caller can answer 429 instead of growing without
 * bound. Shutdown stops accepting work, gives running jobs a grace period and
 * drops whatever is still waiting.
 */

import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

export type EnqueueOutcome =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "full" | "closed" }

export type ShutdownResult = {
  readonly finished: boolean
  readonly dropped: number
}

export type QueueWorker<T> = (job: T) => Promise<void>

export type QueueOptions<T> = {
  readonly concurrency: number
  readonly limit: number
  readonly worker: QueueWorker<T>
  readonly onError?: (job: T, error: unknown) => void
}

export class ScanQueue<T> {
  private readonly waiting: T[] = []
  private readonly running = new Set<Promise<void>>()
  private readonly idleResolvers: Array<() => void> = []
  private readonly concurrency: number
  private readonly limit: number
  private readonly worker: QueueWorker<T>
  private readonly onError: ((job: T, error: unknown) => void) | undefined
  private active = 0
  private closing = false

  constructor(options: QueueOptions<T>) {
    this.concurrency = Math.max(1, options.concurrency)
    this.limit = Math.max(1, options.limit)
    this.worker = options.worker
    this.onError = options.onError
  }

  get pendingCount(): number {
    return this.waiting.length
  }

  get activeCount(): number {
    return this.active
  }

  get isClosing(): boolean {
    return this.closing
  }

  /**
   * Accepts a job when there is room in the waiting list.
   */
  tryEnqueue(job: T): EnqueueOutcome {
    if (this.closing) {
      return { accepted: false, reason: "closed" }
    }

    if (this.waiting.length >= this.limit) {
      return { accepted: false, reason: "full" }
    }

    this.waiting.push(job)
    this.pump()

    return { accepted: true }
  }

  /**
   * Resolves once nothing is waiting and nothing is running.
   */
  drain(): Promise<void> {
    if (this.waiting.length === 0 && this.active === 0) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  /**
   * Stops accepting work, drops the waiting list and waits up to `graceMs` for
   * running jobs to finish.
   */
  async shutdown(graceMs: number): Promise<ShutdownResult> {
    this.closing = true

    const dropped = this.waiting.length
    this.waiting.length = 0

    if (this.active === 0) {
      this.notifyIdle()

      return { finished: true, dropped }
    }

    const settled = Promise.all([...this.running]).then(() => true)

    let timer: ReturnType<typeof setTimeout> | undefined

    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false)
      }, graceMs)
    })

    const finished = await Promise.race([settled, expired])

    if (timer !== undefined) {
      clearTimeout(timer)
    }

    return { finished, dropped }
  }

  private notifyIdle(): void {
    if (this.waiting.length > 0 || this.active > 0) {
      return
    }

    const resolvers = this.idleResolvers.splice(0, this.idleResolvers.length)

    for (const resolve of resolvers) {
      resolve()
    }
  }

  private pump(): void {
    while (!this.closing && this.active < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()

      if (job === undefined) {
        break
      }

      this.active += 1

      const run = async (): Promise<void> => {
        await this.worker(job)
      }

      const promise = run()
        .catch((error: unknown) => {
          this.onError?.(job, error)
        })
        .finally(() => {
          this.active -= 1
          this.running.delete(promise)
          this.pump()
          this.notifyIdle()
        })

      this.running.add(promise)
    }

    this.notifyIdle()
  }
}

/**
 * Empties the work directory at startup: any file left there belongs to a job
 * from a previous run that died before its own cleanup.
 */
export async function prepareWorkDir(directory: string): Promise<number> {
  let names: string[]

  try {
    names = await readdir(directory)
  } catch {
    return 0
  }

  let removed = 0

  for (const name of names) {
    try {
      await rm(join(directory, name), { recursive: true, force: true })
      removed += 1
    } catch {
      continue
    }
  }

  return removed
}
