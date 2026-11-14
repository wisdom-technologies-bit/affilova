import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Job } from "@/lib/jobs/types"

import * as routeModule from "./route"

const SECRET = "8f4c1f6a2b7d9e0c3a5f8b1d4e7a0c2f"

// The cron secret is read through lib/env.ts, which parses process.env lazily on
// first use, so setting it here is enough.
process.env.CRON_SECRET = SECRET
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"

// Mutable state for the fake heartbeats read, reachable from inside a hoisted
// vi.mock factory.
const adminState = vi.hoisted(() => ({
  rows: [] as { job: string; last_run_at: string }[],
  error: null as { message: string } | null,
  // cleanup_rate_limits(): the RPC answer, or an error to throw on.
  cleanupData: 0 as unknown,
  cleanupError: null as { message: string } | null,
  keepOldRateLimits: 0,
}))

vi.mock("@/lib/jobs/queue", () => ({
  claimJobs: vi.fn(async () => []),
  completeJob: vi.fn(async () => undefined),
  failJob: vi.fn(async () => undefined),
  releaseJob: vi.fn(async () => undefined),
  recordHeartbeat: vi.fn(async () => undefined),
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      select: async () => ({ data: adminState.rows, error: adminState.error }),
    }),
    rpc: async (name: string) => {
      if (name !== "cleanup_rate_limits") {
        return { data: null, error: { message: `unexpected rpc ${name}` } }
      }

      return { data: adminState.cleanupData, error: adminState.cleanupError }
    },
  }),
}))

import * as queue from "@/lib/jobs/queue"

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

function callRoute(job: string, authorization?: string) {
  const headers = new Headers()

  if (authorization !== undefined) {
    headers.set("authorization", authorization)
  }

  return routeModule.POST(
    new Request(`http://localhost/api/cron/${job}`, { method: "POST", headers }),
    { params: Promise.resolve({ job }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  adminState.rows = []
  adminState.error = null
  adminState.cleanupData = 0
  adminState.cleanupError = null
})

describe("POST /api/cron/[job]", () => {
  it("answers 401 with only an error field when the header is missing", async () => {
    const response = await callRoute("process-queue")
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: "unauthorized" })
    expect(Object.keys(body)).toEqual(["error"])
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("answers 401 for a wrong secret and for another scheme", async () => {
    const wrong = await callRoute("process-queue", `Bearer ${"0".repeat(SECRET.length)}`)
    const basic = await callRoute("process-queue", `Basic ${SECRET}`)

    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: "unauthorized" })
    expect(basic.status).toBe(401)
    expect(await basic.json()).toEqual({ error: "unauthorized" })
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("answers 404 for an unknown job after a valid secret", async () => {
    const response = await callRoute("drop-database", `Bearer ${SECRET}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not_found" })
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("runs the queue and returns the counts for process-queue", async () => {
    vi.mocked(queue.claimJobs).mockResolvedValueOnce([makeJob("job-1")])

    const response = await callRoute("process-queue", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      claimed: 1,
      completed: 1,
      failed: 0,
      released: 0,
    })
    expect(queue.completeJob).toHaveBeenCalledWith("job-1")
  })

  it("records a heartbeat on a successful run", async () => {
    await callRoute("process-queue", `Bearer ${SECRET}`)

    expect(queue.recordHeartbeat).toHaveBeenCalledTimes(1)
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "process-queue",
      "ok",
      expect.any(Number),
      null,
    )
  })

  it("records an error heartbeat and answers 500 without details", async () => {
    vi.mocked(queue.claimJobs).mockRejectedValueOnce(new Error("connection refused"))

    const response = await callRoute("process-queue", `Bearer ${SECRET}`)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false })
    expect(JSON.stringify(body)).not.toContain("connection refused")
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "process-queue",
      "error",
      expect.any(Number),
      "connection refused",
    )
  })

  it("lists the schedules that have not reported in for over five minutes", async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    adminState.rows = [{ job: "process-queue", last_run_at: sixMinutesAgo }]

    const response = await callRoute("heartbeat-check", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    // process-queue is overdue and heartbeat-check has never reported.
    expect(await response.json()).toEqual({
      ok: true,
      stale: ["process-queue", "heartbeat-check"],
    })
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "heartbeat-check",
      "ok",
      expect.any(Number),
      null,
    )
  })

  it("reports nothing stale when both schedules reported recently", async () => {
    const justNow = new Date().toISOString()
    adminState.rows = [
      { job: "process-queue", last_run_at: justNow },
      { job: "heartbeat-check", last_run_at: justNow },
    ]

    const response = await callRoute("heartbeat-check", `Bearer ${SECRET}`)

    expect(await response.json()).toEqual({ ok: true, stale: [] })
  })

  it("runs the cleanup job and reports how many rows went", async () => {
    adminState.cleanupData = 7

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, deleted: 7 })
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "cleanup",
      "ok",
      expect.any(Number),
      null,
    )
    // The queue is not touched by cleanup.
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("accepts the RPC answer in an array shape too", async () => {
    adminState.cleanupData = [3]

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(await response.json()).toEqual({ ok: true, deleted: 3 })
  })

  it("treats an unexpected cleanup answer as zero, not as a failure", async () => {
    adminState.cleanupData = null

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, deleted: 0 })
  })

  it("records an error heartbeat and answers 500 when cleanup fails", async () => {
    adminState.cleanupError = { message: "permission denied for table rate_limits" }

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false })
    // The database message never leaves the server.
    expect(JSON.stringify(body)).not.toContain("rate_limits")
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "cleanup",
      "error",
      expect.any(Number),
      "Could not clean up rate limits",
    )
  })

  it("still refuses an unknown job after a valid secret", async () => {
    const response = await callRoute("cleanup-old", `Bearer ${SECRET}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not_found" })
  })

  it("does not watch cleanup for staleness, since it runs once a day", async () => {
    adminState.rows = [
      { job: "process-queue", last_run_at: new Date().toISOString() },
      { job: "heartbeat-check", last_run_at: new Date().toISOString() },
    ]

    const response = await callRoute("heartbeat-check", `Bearer ${SECRET}`)

    expect(await response.json()).toEqual({ ok: true, stale: [] })
  })

  it("requires the secret for the cleanup job too", async () => {
    const response = await callRoute("cleanup")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("exports POST and no GET", () => {
    expect(typeof routeModule.POST).toBe("function")
    expect("GET" in routeModule).toBe(false)
  })
})
