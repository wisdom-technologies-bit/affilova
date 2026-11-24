import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  handleTransferApproval,
  tokenMatches,
  type TransferApprovalDeps,
} from "./route"

// The approval hook, called directly so no environment is read. The rate limiter
// is faked through the Supabase admin client it uses.

const TOKEN = "t".repeat(40)
const REFERENCE = "wd_abcdefghijklmnopqrstuvwx"
const RECIPIENT = "RCP_abc123def456"

const state = vi.hoisted(() => ({
  allowed: true,
  rpcError: null as { message: string } | null,
}))

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: async () => {
      if (state.rpcError !== null) {
        return { data: null, error: state.rpcError }
      }

      // The limiter reads a one-row set.
      return {
        data: [{ allowed: state.allowed, remaining: 10, reset_at: new Date().toISOString() }],
        error: null,
      }
    },
  }),
}))

interface Row {
  found: boolean
  status: string | null
  netKobo: bigint | null
  recipientCode: string | null
  transferCode: string | null
}

function makeDeps(row: Row, overrides: Partial<TransferApprovalDeps> = {}) {
  const logs: Array<{ level: string; event: string; fields: unknown }> = []

  const deps: TransferApprovalDeps = {
    token: TOKEN,
    enforceIps: false,
    getWithdrawalForApproval: async () => row,
    log: {
      info: (event, fields) => void logs.push({ level: "info", event, fields }),
      warn: (event, fields) => void logs.push({ level: "warn", event, fields }),
      error: (event, fields) => void logs.push({ level: "error", event, fields }),
    },
    ...overrides,
  }

  return { deps, logs }
}

const matching: Row = {
  found: true,
  status: "processing",
  netKobo: BigInt(500000),
  recipientCode: RECIPIENT,
  transferCode: "TRF_abc123",
}

function call(
  deps: TransferApprovalDeps,
  body: unknown,
  token = TOKEN,
  init: RequestInit = {},
): Promise<Response> {
  const method = init.method ?? "POST"
  // A GET request may not carry a body, so only a POST gets one.
  const payload =
    method === "GET"
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }

  return handleTransferApproval(
    new Request(`http://localhost/api/paystack/transfer-approval/${token}`, {
      headers: { "content-type": "application/json" },
      ...init,
      method,
      ...payload,
    }),
    token,
    deps,
  )
}

const validBody = {
  source: "balance",
  amount: 500000,
  recipient: RECIPIENT,
  reference: REFERENCE,
  reason: "Affilova payout",
}

beforeEach(() => {
  state.allowed = true
  state.rpcError = null
})

describe("tokenMatches", () => {
  it("accepts only the exact token", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
    expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN.slice(0, 10), TOKEN)).toBe(false)
    expect(tokenMatches("", TOKEN)).toBe(false)
  })
})

describe("POST /api/paystack/transfer-approval/[token]", () => {
  it("approves a matching transfer with 200 and an empty object", async () => {
    const { deps } = makeDeps(matching)

    const response = await call(deps, validBody)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it("declines with 400 when the amount is not the net", async () => {
    const { deps, logs } = makeDeps(matching)

    const response = await call(deps, { ...validBody, amount: 499999 })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({})
    expect(logs.some((entry) => entry.level === "error")).toBe(true)
  })

  it("declines when the recipient is not the active payout account", async () => {
    const { deps } = makeDeps(matching)

    expect((await call(deps, { ...validBody, recipient: "RCP_other" })).status).toBe(400)
  })

  it("declines when the withdrawal is not processing", async () => {
    for (const status of ["approved", "paid", "failed", "requested"]) {
      const { deps } = makeDeps({ ...matching, status })

      expect((await call(deps, validBody)).status).toBe(400)
    }
  })

  it("declines a reference we do not have", async () => {
    const { deps } = makeDeps({
      found: false,
      status: null,
      netKobo: null,
      recipientCode: null,
      transferCode: null,
    })

    expect((await call(deps, validBody)).status).toBe(400)
  })

  it("answers 404 with an empty body for a wrong token", async () => {
    const { deps } = makeDeps(matching)

    const response = await call(deps, validBody, "wrong-token")

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("")
  })

  it("answers 404 when no token is configured", async () => {
    const { deps } = makeDeps(matching, { token: "" })

    expect((await call(deps, validBody)).status).toBe(404)
  })

  it("declines a malformed body without throwing", async () => {
    const { deps } = makeDeps(matching)

    expect((await call(deps, "{not json")).status).toBe(400)
    expect((await call(deps, { amount: "500000" })).status).toBe(400)
    expect((await call(deps, { ...validBody, amount: 500.5 })).status).toBe(400)
  })

  it("declines a batch outright", async () => {
    const { deps } = makeDeps(matching)

    expect((await call(deps, [validBody])).status).toBe(400)
  })

  it("declines when the row cannot be read", async () => {
    const { deps } = makeDeps(matching, {
      getWithdrawalForApproval: async () => {
        throw new Error("down")
      },
    })

    expect((await call(deps, validBody)).status).toBe(400)
  })

  it("refuses the wrong method", async () => {
    const { deps } = makeDeps(matching)

    expect((await call(deps, validBody, TOKEN, { method: "GET" })).status).toBe(405)
  })

  it("answers 429 when the limiter is exhausted", async () => {
    state.allowed = false
    const { deps } = makeDeps(matching)

    expect((await call(deps, validBody)).status).toBe(429)
  })

  it("denies when the limiter cannot count", async () => {
    state.rpcError = { message: "down" }
    const { deps } = makeDeps(matching)

    expect((await call(deps, validBody)).status).toBe(429)
  })

  it("never logs the amount, the recipient code or the token", async () => {
    const { deps, logs } = makeDeps(matching)

    await call(deps, validBody)
    await call(deps, { ...validBody, amount: 1 })

    const text = JSON.stringify(logs)

    expect(text).not.toContain(RECIPIENT)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain("500000")
  })
})
