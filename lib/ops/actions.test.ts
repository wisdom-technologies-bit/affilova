import { beforeEach, describe, expect, it, vi } from "vitest"

import { GENERIC_ERROR } from "@/lib/catalog/errors"

// The two admin Security actions. The rules they enforce are the whole point of
// the file: who may read the overview, who may run the self-test, how often, and
// what the audit row says. Each one is checked with fakes, so a green run means
// the gate is right, not that a service was up.

const ADMIN = "33333333-3333-3333-3333-333333333333"
const MODERATOR = "44444444-4444-4444-4444-444444444444"
const SUPPORT = "55555555-5555-5555-5555-555555555555"

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  roles: [] as string[],
  db: null as unknown,
  health: null as unknown,
  selfTest: null as unknown,
  allowed: true,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => state.db,
}))

vi.mock("@/lib/ops/scanner-selftest", () => ({
  getScannerHealth: async () => state.health,
  runScannerSelfTest: async () => state.selfTest,
}))

const rateLimitCalls: { key: string; limit: number; windowSeconds: number; onError: string | undefined }[] = []

vi.mock("@/lib/rate-limit", () => ({
  rateLimitKey: (parts: readonly string[]) => parts.join("|"),
  rateLimit: async (options: {
    key: string
    limit: number
    windowSeconds: number
    onError?: string
  }) => {
    rateLimitCalls.push({
      key: options.key,
      limit: options.limit,
      windowSeconds: options.windowSeconds,
      onError: options.onError,
    })

    return { allowed: state.allowed, remaining: 0, resetAt: new Date("2026-11-18T14:00:00.000Z") }
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from "@/lib/logger"
import { getSecurityOverviewAction, runScannerSelfTestAction } from "@/lib/ops/actions"
import type { ScannerHealth } from "@/lib/ops/scanner-selftest"

interface InsertCall {
  table: string
  row: Record<string, unknown>
}

interface DbOptions {
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }
  insertError?: { code: string } | null
}

function createDb(options: DbOptions = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const inserts: InsertCall[] = []

  const client = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args })

      return options.rpc === undefined ? { data: null, error: null } : options.rpc(name, args)
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row })

        return { error: options.insertError ?? null }
      },
    }),
  }

  return { client, rpcCalls, inserts }
}

const HEALTH: ScannerHealth = { state: "ok", clamd: true, signatureAgeHours: 7 }

const SCAN_OVERVIEW = {
  counts: { not_scanned: 2, queued: 1, clean: 5 },
  oldest_queued_minutes: 12.5,
  scans_last_24h: 40,
  infected_last_30d: 1,
}

const JOB_OVERVIEW = {
  counts: { queued: 3, done: 10 },
  oldest_queued_minutes: 0.5,
  dead_count: 1,
  heartbeats: [
    {
      job: "process-queue",
      last_run_at: "2026-11-18T13:30:00.000Z",
      last_status: "ok",
      last_duration_ms: 120,
      age_seconds: 60,
    },
  ],
}

const EVENTS = [
  {
    verdict: "clean",
    detail: "clean",
    engine: "clamav",
    signature_version: "28186",
    created_at: "2026-11-18T13:00:00.000Z",
  },
]

const SELF_TEST_RESULT = {
  rows: [
    { name: "hello.txt", expected: "clean (clean)", actual: "clean (clean)", passed: true, durationMs: 40 },
    { name: "eicar.txt", expected: "infected (Eicar…)", actual: "infected (Eicar-Test-Signature)", passed: true, durationMs: 20 },
    { name: "not-a-pdf.pdf", expected: "rejected (executable_type)", actual: "rejected (executable_type)", passed: true, durationMs: 9 },
    { name: "archive.zip", expected: "needs_review (archive_contains_executable)", actual: "needs_review (archive_contains_executable)", passed: true, durationMs: 18 },
  ],
  health: HEALTH,
  passedCount: 4,
  failedCount: 0,
}

beforeEach(() => {
  state.user = { id: ADMIN, email: "admin@example.com" }
  state.roles = ["customer", "admin"]
  state.health = HEALTH
  state.selfTest = SELF_TEST_RESULT
  state.allowed = true
  rateLimitCalls.length = 0
  vi.mocked(logger.error).mockClear()
  state.db = createDb({
    rpc: (name) => {
      if (name === "scan_overview") {
        return { data: SCAN_OVERVIEW, error: null }
      }

      if (name === "job_overview") {
        return { data: JOB_OVERVIEW, error: null }
      }

      if (name === "list_recent_scan_events") {
        return { data: EVENTS, error: null }
      }

      return { data: null, error: null }
    },
  }).client
})

describe("getSecurityOverviewAction", () => {
  it("refuses a visitor who is not signed in", async () => {
    state.user = null

    const result = await getSecurityOverviewAction()

    expect(result).toEqual({ ok: false, error: "Sign in to continue." })
  })

  it("refuses support staff, who hold area:admin but not the scanner roles", async () => {
    state.user = { id: SUPPORT, email: "support@example.com" }
    state.roles = ["customer", "support"]

    const result = await getSecurityOverviewAction()

    expect(result).toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("refuses finance, for the same reason", async () => {
    state.roles = ["customer", "finance"]

    const result = await getSecurityOverviewAction()

    expect(result.ok).toBe(false)
  })

  it("allows a moderator", async () => {
    state.user = { id: MODERATOR, email: "moderator@example.com" }
    state.roles = ["customer", "moderator"]

    const result = await getSecurityOverviewAction()

    expect(result.ok).toBe(true)
  })

  it("returns the scanner health, the pipeline, the queue and the latest verdicts", async () => {
    const result = await getSecurityOverviewAction()

    if (!result.ok) {
      throw new Error("expected the overview")
    }

    expect(result.overview.scanner).toEqual(HEALTH)
    expect(result.overview.scan.oldestQueuedMinutes).toBe(12.5)
    expect(result.overview.scan.scansLast24h).toBe(40)
    expect(result.overview.scan.infectedLast30d).toBe(1)
    expect(result.overview.jobs.deadCount).toBe(1)
    expect(result.overview.jobs.heartbeats).toHaveLength(1)
    expect(result.overview.jobs.heartbeats[0].job).toBe("process-queue")
    expect(result.overview.events).toHaveLength(1)
    expect(result.overview.events[0].signatureVersion).toBe("28186")
  })

  it("fills every scan and job status, zeros included, so the page renders a stable list", async () => {
    const result = await getSecurityOverviewAction()

    if (!result.ok) {
      throw new Error("expected the overview")
    }

    expect(result.overview.scan.counts).toEqual({
      not_scanned: 2,
      queued: 1,
      scanning: 0,
      clean: 5,
      infected: 0,
      rejected: 0,
      needs_review: 0,
      error: 0,
    })
    expect(result.overview.jobs.counts).toEqual({
      queued: 3,
      running: 0,
      done: 10,
      failed: 0,
      dead: 0,
    })
  })

  it("asks for twenty recent events, and no more", async () => {
    const db = createDb({
      rpc: (name) =>
        name === "list_recent_scan_events"
          ? { data: EVENTS, error: null }
          : { data: null, error: null },
    })

    state.db = db.client

    await getSecurityOverviewAction()

    expect(db.rpcCalls.find((call) => call.name === "list_recent_scan_events")?.args).toEqual({
      p_limit: 20,
    })
  })

  it("answers the generic sentence when a function fails", async () => {
    state.db = createDb({
      rpc: (name) =>
        name === "scan_overview"
          ? { data: null, error: { message: "permission denied for function scan_overview" } }
          : { data: null, error: null },
    }).client

    const result = await getSecurityOverviewAction()

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR })
  })

  it("never puts a database message in the answer", async () => {
    state.db = createDb({
      rpc: () => ({ data: null, error: { message: "relation public.product_files does not exist" } }),
    }).client

    const result = await getSecurityOverviewAction()
    const text = JSON.stringify(result)

    expect(text).not.toContain("product_files")
    expect(text).not.toContain("relation")
  })

  it("turns a malformed answer into zeros rather than crashing", async () => {
    state.db = createDb({
      rpc: () => ({ data: { counts: "not an object", heartbeats: [{ job: 42 }] }, error: null }),
    }).client

    const result = await getSecurityOverviewAction()

    if (!result.ok) {
      throw new Error("expected the overview")
    }

    expect(result.overview.scan.counts.not_scanned).toBe(0)
    expect(result.overview.jobs.heartbeats).toEqual([])
    expect(result.overview.events).toEqual([])
  })

  it("still shows the overview when the scanner cannot be reached", async () => {
    state.health = { state: "unreachable", clamd: false, signatureAgeHours: null }

    const result = await getSecurityOverviewAction()

    if (!result.ok) {
      throw new Error("expected the overview")
    }

    expect(result.overview.scanner.state).toBe("unreachable")
    expect(result.overview.scan.counts.clean).toBe(5)
  })
})

describe("runScannerSelfTestAction", () => {
  it("refuses a moderator: the self-test writes to the bucket", async () => {
    state.user = { id: MODERATOR, email: "moderator@example.com" }
    state.roles = ["customer", "moderator"]

    const result = await runScannerSelfTestAction()

    expect(result).toEqual({ ok: false, error: "You do not have access to that." })
  })

  it("refuses support staff", async () => {
    state.roles = ["customer", "support"]

    const result = await runScannerSelfTestAction()

    expect(result.ok).toBe(false)
  })

  it("refuses a visitor who is not signed in", async () => {
    state.user = null

    const result = await runScannerSelfTestAction()

    expect(result).toEqual({ ok: false, error: "Sign in to continue." })
  })

  it("returns the four rows and the counts for an admin", async () => {
    const result = await runScannerSelfTestAction()

    if (!result.ok) {
      throw new Error("expected the rows")
    }

    expect(result.rows).toHaveLength(4)
    expect(result.passedCount).toBe(4)
    expect(result.failedCount).toBe(0)
    expect(result.health).toEqual(HEALTH)
  })

  it("counts five runs an hour per person, and denies when it cannot count", async () => {
    await runScannerSelfTestAction()

    expect(rateLimitCalls).toHaveLength(1)
    expect(rateLimitCalls[0]).toEqual({
      key: `ops|scanner-selftest|${ADMIN}`,
      limit: 5,
      windowSeconds: 3600,
      onError: "deny",
    })
  })

  it("answers the rate-limit sentence and does not run when the allowance is used up", async () => {
    state.allowed = false

    const result = await runScannerSelfTestAction()

    expect(result).toEqual({
      ok: false,
      error: "Too many attempts. Please wait a few minutes and try again.",
    })
  })

  it("writes one audit row with the counts and nothing else", async () => {
    const db = createDb()

    state.db = db.client

    await runScannerSelfTestAction()

    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0].table).toBe("audit_log")
    expect(db.inserts[0].row).toEqual({
      actor_id: ADMIN,
      action: "ops.scanner_selftest",
      entity_type: "scanner",
      entity_id: "selftest",
      after: { passed: 4, failed: 0, total: 4 },
    })
  })

  it("keeps sample names, verdicts and URLs out of the audit row", async () => {
    const db = createDb()

    state.db = db.client

    await runScannerSelfTestAction()

    const text = JSON.stringify(db.inserts[0].row)

    expect(text).not.toContain("eicar")
    expect(text).not.toContain("hello.txt")
    expect(text).not.toContain("infected")
    expect(text).not.toContain("http")
  })

  it("still returns the verdicts when the audit row cannot be written", async () => {
    state.db = createDb({ insertError: { code: "42501" } }).client

    const result = await runScannerSelfTestAction()

    expect(result.ok).toBe(true)
    expect(logger.error).toHaveBeenCalledWith("ops_selftest_audit_failed", { reason: "42501" })
  })

  it("answers the generic sentence when the runner gives back nothing usable", async () => {
    // A runner that resolves with no result is what a broken storage client or a
    // missing environment variable looks like from here: the action must not
    // throw into the page, and must not report a pass.
    state.selfTest = null
    state.db = createDb().client

    const result = await runScannerSelfTestAction()

    expect(result).toEqual({ ok: false, error: GENERIC_ERROR })
    expect(logger.error).toHaveBeenCalledWith("ops_selftest_failed", { reason: "TypeError" })
  })
})
