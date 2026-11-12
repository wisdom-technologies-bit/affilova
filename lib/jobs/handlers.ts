import type { Job } from "./types"

/** A unit of work for one job type. Throwing means the job failed. */
export type JobHandler = (job: Job) => Promise<void>

// Handlers register themselves at module load, so importing this file (directly,
// from the cron route) is what makes the handlers available.
const handlers = new Map<string, JobHandler>()

export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler)
}

export function getHandler(type: string): JobHandler | undefined {
  return handlers.get(type)
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()]
}

// Placeholder job type. It exists so the queue can be exercised end to end
// before any real work is implemented.
const noopHandler: JobHandler = async () => {
  // Intentionally empty.
}

registerHandler("noop", noopHandler)
