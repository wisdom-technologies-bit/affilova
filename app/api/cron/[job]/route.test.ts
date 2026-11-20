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
  // purge_old_webhook_events(): the RPC answer, or an error to throw on.
  purgeData: 0 as unknown,
  purgeError: null as { message: string } | null,
  keepOldRateLimits: 0,
  enqueued: [] as { type: string; dedupeKey?: string }[],
  enqueueError: null as Error | null,
  // purge_old_clicks(): the click retention sweep.
  purgeClicksData: 0 as unknown,
  purgeClicksError: null as { message: string } | null,
  // rollup_affiliate_stats() and scan_click_anomalies().
  rollupData: 0 as unknown,
  rollupError: null as { message: string } | null,
  rollupCalls: [] as { p_from: string; p_to: string }[],
  scanData: 0 as unknown,
  scanError: null as { message: string } | null,
}))

vi.mock("@/lib/jobs/queue", () => ({
  claimJobs: vi.fn(async () => []),
  completeJob: vi.fn(async () => undefined),
  enqueueJob: vi.fn(async (input: { type: string; dedupeKey?: string }) => {
    if (adminState.enqueueError) {
      throw adminState.enqueueError
    }

    adminState.enqueued.push(input)

    return "job-id"
  }),
  failJob: vi.fn(async () => undefined),
  releaseJob: vi.fn(async () => undefined),
  recordHeartbeat: vi.fn(async () => undefined),
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      select: async () => ({ data: adminState.rows, error: adminState.error }),
    }),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "rollup_affiliate_stats" && args !== undefined) {
        adminState.rollupCalls.push({ p_from: String(args.p_from), p_to: String(args.p_to) })
      }

      if (name === "cleanup_rate_limits") {
        return { data: adminState.cleanupData, error: adminState.cleanupError }
      }

      if (name === "purge_old_webhook_events") {
        return { data: adminState.purgeData, error: adminState.purgeError }
      }

      if (name === "purge_old_clicks") {
        return { data: adminState.purgeClicksData, error: adminState.purgeClicksError }
      }

      if (name === "rollup_affiliate_stats") {
        return { data: adminState.rollupData, error: adminState.rollupError }
      }

      if (name === "scan_click_anomalies") {
        return { data: adminState.scanData, error: adminState.scanError }
      }

      return { data: null, error: { message: `unexpected rpc ${name}` } }
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
  adminState.purgeData = 0
  adminState.purgeError = null
  adminState.enqueued = []
  adminState.enqueueError = null
  adminState.purgeClicksData = 0
  adminState.purgeClicksError = null
  adminState.rollupData = 0
  adminState.rollupError = null
  adminState.rollupCalls = []
  adminState.scanData = 0
  adminState.scanError = null
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
    expect(await response.json()).toEqual({
      ok: true,
      deleted: 7,
      storageCleanupQueued: true,
      webhookEventsPurged: 0,
      clicksPurged: 0,
    })
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "cleanup",
      "ok",
      expect.any(Number),
      null,
    )
    // Only enqueuing touches the queue; nothing is claimed.
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("queues one scan sweep per minute, keyed by the minute bucket", async () => {
    const response = await callRoute("scan-sweep", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, scanSweepQueued: true })
    expect(adminState.enqueued).toHaveLength(1)

    const [enqueued] = adminState.enqueued

    expect(enqueued?.type).toBe("scan_sweep")
    expect(enqueued?.dedupeKey).toBe(`scan_sweep:${new Date().toISOString().slice(0, 16)}`)
    expect(queue.recordHeartbeat).toHaveBeenCalledWith(
      "scan-sweep",
      "ok",
      expect.any(Number),
      null,
    )
    // The sweep itself is a queued job: this endpoint never claims work.
    expect(queue.claimJobs).not.toHaveBeenCalled()
  })

  it("reports an enqueue that failed without failing the run", async () => {
    adminState.enqueueError = new Error("queue is down")

    const response = await callRoute("scan-sweep", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, scanSweepQueued: false })
  })

  it("queues the daily storage sweep once, keyed by the UTC date", async () => {
    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(adminState.enqueued).toHaveLength(1)

    const [enqueued] = adminState.enqueued

    expect(enqueued?.type).toBe("storage_cleanup")
    expect(enqueued?.dedupeKey).toBe(
      `storage_cleanup:${new Date().toISOString().slice(0, 10)}`,
    )
  })

  it("reports a failed enqueue without failing the run", async () => {
    adminState.enqueueError = new Error("queue is down")

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      deleted: 0,
      storageCleanupQueued: false,
      webhookEventsPurged: 0,
      clicksPurged: 0,
    })
    expect(queue.recordHeartbeat).toHaveBeenCalledWith("cleanup", "ok", expect.any(Number), null)
  })

  it("accepts the RPC answer in an array shape too", async () => {
    adminState.cleanupData = [3]

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(await response.json()).toEqual({
      ok: true,
      deleted: 3,
      storageCleanupQueued: true,
      webhookEventsPurged: 0,
      clicksPurged: 0,
    })
  })

  it("treats an unexpected cleanup answer as zero, not as a failure", async () => {
    adminState.cleanupData = null

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      deleted: 0,
      storageCleanupQueued: true,
      webhookEventsPurged: 0,
      clicksPurged: 0,
    })
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

describe("cleanup and the webhook log", () => {
  it("reports how many old webhook deliveries were forgotten", async () => {
    adminState.purgeData = 4

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(await response.json()).toEqual({
      ok: true,
      deleted: 0,
      storageCleanupQueued: true,
      webhookEventsPurged: 4,
      clicksPurged: 0,
    })
  })

  it("accepts the purge answer in an array shape too", async () => {
    adminState.purgeData = [2]

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(await response.json()).toMatchObject({ ok: true, webhookEventsPurged: 2 })
  })

  it("answers 500 when the purge fails, since the sweep did not finish", async () => {
    adminState.purgeError = { message: "relation webhook_events does not exist" }

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false })
    expect(JSON.stringify(body)).not.toContain("webhook_events")
  })
})

describe("the affiliate jobs", () => {
  it("rolls up yesterday and today in Lagos time", async () => {
    adminState.rollupData = 3

    const response = await callRoute("rollups", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, days: 2, rows: 3 })
    expect(adminState.rollupCalls).toHaveLength(1)

    const call = adminState.rollupCalls[0]
    expect(call?.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(call?.p_to).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Yesterday is exactly one day before today, both Lagos days.
    const from = new Date(`${call?.p_from}T00:00:00Z`).getTime()
    const to = new Date(`${call?.p_to}T00:00:00Z`).getTime()
    expect(to - from).toBe(24 * 60 * 60 * 1000)

    expect(queue.recordHeartbeat).toHaveBeenCalledWith("rollups", "ok", expect.any(Number), null)
  })

  it("answers 500 without details when the rollup fails", async () => {
    adminState.rollupError = { message: 'relation "affiliate_clicks" does not exist' }

    const response = await callRoute("rollups", `Bearer ${SECRET}`)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false })
    expect(JSON.stringify(body)).not.toContain("affiliate_clicks")
  })

  it("scans for click anomalies and reports how many flags were added", async () => {
    adminState.scanData = 2

    const response = await callRoute("risk-scan", `Bearer ${SECRET}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, flags: 2 })
    expect(queue.recordHeartbeat).toHaveBeenCalledWith("risk-scan", "ok", expect.any(Number), null)
  })

  it("answers 500 when the risk scan fails", async () => {
    adminState.scanError = { message: "permission denied for function scan_click_anomalies" }

    const response = await callRoute("risk-scan", `Bearer ${SECRET}`)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false })
  })

  it("purges old clicks with the cleanup job", async () => {
    adminState.purgeClicksData = 12

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(await response.json()).toMatchObject({ ok: true, clicksPurged: 12 })
  })

  it("answers 500 when the click purge fails", async () => {
    adminState.purgeClicksError = { message: "permission denied for function purge_old_clicks" }

    const response = await callRoute("cleanup", `Bearer ${SECRET}`)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false })
  })

  it("still refuses these job names without the secret", async () => {
    const rollups = await callRoute("rollups")
    const scan = await callRoute("risk-scan")

    expect(rollups.status).toBe(401)
    expect(scan.status).toBe(401)
    expect(adminState.rollupCalls).toHaveLength(0)
  })
})
