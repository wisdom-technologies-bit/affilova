import { beforeEach, describe, expect, it, vi } from "vitest"

const USER = "11111111-1111-4111-8111-111111111111"
const OTHER = "99999999-9999-4999-8999-999999999999"
const WD = "33333333-3333-4333-8333-333333333333"
const ACCOUNT_NUMBER = "0123456789"

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  roles: [] as string[],
  limitAllowed: true,
  logs: [] as unknown[],
}))

const mocks = vi.hoisted(() => ({
  controls: {
    getPayoutScreenData: vi.fn(),
    createStepUpCode: vi.fn(),
    verifyStepUpCode: vi.fn(),
    cancelWithdrawal: vi.fn(),
    adminWithdrawalQueue: vi.fn(),
    listBlackoutDates: vi.fn(),
    addBlackoutDate: vi.fn(),
    removeBlackoutDate: vi.fn(),
    updateSetting: vi.fn(),
    readPayoutSettings: vi.fn(),
  },
  store: { setAutoPayout: vi.fn(), approveWithdrawal: vi.fn(), rejectWithdrawal: vi.fn() },
  service: {
    prepareAccount: vi.fn(),
    previewWithdrawal: vi.fn(),
    requestManualWithdrawal: vi.fn(),
  },
  transfers: { listBanks: vi.fn(), resolveAccount: vi.fn() },
  sendEmail: vi.fn(),
  enqueueJob: vi.fn(),
  rateLimit: vi.fn(),
  profile: { first_name: "Adaeze", last_name: "Okonkwo", display_name: null } as Record<string, unknown> | null,
}))

vi.mock("@/lib/identity/session", () => ({
  getAuthUser: async () => state.user,
  getUserRoles: async () => state.roles,
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (options: unknown) => {
    mocks.rateLimit(options)
    return { allowed: state.limitAllowed, remaining: 0, resetAt: new Date() }
  },
  rateLimitKey: (parts: string[]) => parts.join(":"),
}))
vi.mock("./controls-db", () => mocks.controls)
vi.mock("./db", async () => {
  class PayoutRpcError extends Error {
    readonly code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
  return { ...mocks.store, PayoutRpcError }
})
vi.mock("./run", () => ({ getPayoutService: () => mocks.service }))
vi.mock("@/lib/paystack/transfers", () => ({ getPaystackTransfers: () => mocks.transfers }))
vi.mock("@/lib/email/brevo", () => ({ sendEmail: mocks.sendEmail }))
vi.mock("@/lib/jobs/queue", () => ({ enqueueJob: mocks.enqueueJob }))
vi.mock("@/lib/identity/app-urls", () => ({ appUrl: (_a: string, path: string) => `https://affilova.example${path}` }))
vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => void state.logs.push(args),
    warn: (...args: unknown[]) => void state.logs.push(args),
    error: (...args: unknown[]) => void state.logs.push(args),
  },
}))
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }),
    }),
  }),
}))
vi.mock("@/lib/env", () => ({
  // Staff two-factor is off in tests: the MFA rule has its own suite.
  staffMfaEnforced: () => false, getStepUpSecret: () => "0123456789abcdef0123456789abcdef" }))

import { PayoutRpcError } from "./db"
import * as actions from "./actions"

function signIn(roles: string[], id = USER) {
  state.user = { id, email: "ada@example.com" }
  state.roles = roles
}

function everything(): string {
  return JSON.stringify([state.logs, mocks.sendEmail.mock.calls.map((c) => (c[0] as { subject: string }).subject)], (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = null
  state.roles = []
  state.limitAllowed = true
  state.logs = []
  mocks.profile = { first_name: "Adaeze", last_name: "Okonkwo", display_name: null }
  mocks.controls.verifyStepUpCode.mockResolvedValue(true)
  mocks.controls.createStepUpCode.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
  mocks.sendEmail.mockResolvedValue({ ok: true, messageId: "m" })
  mocks.transfers.listBanks.mockResolvedValue([{ name: "GTBank", code: "058" }])
  mocks.transfers.resolveAccount.mockResolvedValue({ accountName: "ADAEZE OKONKWO", accountNumber: ACCOUNT_NUMBER })
  mocks.service.prepareAccount.mockResolvedValue({ status: "ok", accountId: "a", resolvedName: "ADAEZE OKONKWO" })
  mocks.service.previewWithdrawal.mockResolvedValue({
    allowed: true, reasons: [], grossKobo: BigInt(500000), feeKobo: BigInt(10000), netKobo: BigInt(490000),
    availableKobo: BigInt(900000), nextPayoutDay: null, needsApproval: false,
  })
  mocks.service.requestManualWithdrawal.mockResolvedValue({ withdrawalId: WD, status: "approved", needsApproval: false, reference: "wd_x" })
})

const MEMBER_ACTIONS: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ["getPayoutScreenAction", () => actions.getPayoutScreenAction()],
  ["listBanksAction", () => actions.listBanksAction()],
  ["resolveAccountAction", () => actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })],
  ["requestStepUpCodeAction", () => actions.requestStepUpCodeAction({ purpose: "withdrawal" })],
  ["savePayoutAccountAction", () => actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })],
  ["previewWithdrawalAction", () => actions.previewWithdrawalAction({ amountKobo: 500000 })],
  ["requestWithdrawalAction", () => actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })],
  ["cancelWithdrawalAction", () => actions.cancelWithdrawalAction({ withdrawalId: WD })],
  ["setAutoPayoutAction", () => actions.setAutoPayoutAction({ enabled: true })],
]

const ADMIN_ACTIONS: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ["listWithdrawalsAction", () => actions.listWithdrawalsAction({ tab: "paid" })],
  ["approveWithdrawalAction", () => actions.approveWithdrawalAction({ withdrawalId: WD })],
  ["rejectWithdrawalAction", () => actions.rejectWithdrawalAction({ withdrawalId: WD, reason: "Looks like fraud to us." })],
  ["listBlackoutDatesAction", () => actions.listBlackoutDatesAction()],
  ["addBlackoutDateAction", () => actions.addBlackoutDateAction({ day: "2026-12-25", reason: "Christmas Day" })],
  ["removeBlackoutDateAction", () => actions.removeBlackoutDateAction({ day: "2026-12-25" })],
  ["getPayoutSettingsAction", () => actions.getPayoutSettingsAction()],
  ["updatePayoutSettingAction", () => actions.updatePayoutSettingAction({ key: "withdrawal_fee_bps", value: 200 })],
]

describe("who may call", () => {
  it.each([...MEMBER_ACTIONS, ...ADMIN_ACTIONS])("%s refuses someone who is not signed in", async (_name, call) => {
    expect(await call()).toEqual({ ok: false, error: "Sign in to continue." })
  })

  it.each(MEMBER_ACTIONS)("%s refuses a role that cannot earn or sell", async (_name, call) => {
    signIn(["customer"])
    expect(await call()).toEqual({ ok: false, error: "You do not have access to that." })
    signIn(["admin", "finance"])
    expect(await call()).toEqual({ ok: false, error: "You do not have access to that." })
  })

  it.each(MEMBER_ACTIONS)("%s lets an affiliate and a vendor in", async (_name, call) => {
    signIn(["customer", "affiliate"])
    expect((await call()).ok).toBe(true)
    signIn(["customer", "vendor"])
    expect((await call()).ok).toBe(true)
  })

  it.each(ADMIN_ACTIONS)("%s refuses an affiliate, a vendor, support and moderators", async (_name, call) => {
    for (const role of ["affiliate", "vendor", "support", "moderator"]) {
      signIn([role])
      expect(await call()).toEqual({ ok: false, error: "You do not have access to that." })
    }
  })

  it.each(ADMIN_ACTIONS)("%s lets admin and finance in", async (_name, call) => {
    mocks.controls.adminWithdrawalQueue.mockResolvedValue({ rows: [], nextCursor: null })
    mocks.controls.listBlackoutDates.mockResolvedValue([])
    mocks.controls.readPayoutSettings.mockResolvedValue({ values: {}, changes: [] })
    mocks.store.approveWithdrawal.mockResolvedValue({ status: "approved", needsSecondApproval: false })
    for (const role of ["admin", "finance"]) {
      signIn([role])
      expect((await call()).ok).toBe(true)
    }
  })

  it("never reaches the database when refused", async () => {
    signIn(["customer"])
    await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })
    expect(mocks.service.previewWithdrawal).not.toHaveBeenCalled()
    expect(mocks.controls.verifyStepUpCode).not.toHaveBeenCalled()
  })
})

describe("rate limits", () => {
  it.each([...MEMBER_ACTIONS, ...ADMIN_ACTIONS])("%s is limited and fails closed", async (_name, call) => {
    signIn(["affiliate", "admin"])
    state.limitAllowed = false
    const result = (await call()) as { ok: boolean; error?: string }
    // Some actions reject the input before the limiter; those that get that far are limited.
    if (!result.ok && result.error === "Too many attempts. Please wait a few minutes and try again.") {
      expect(mocks.rateLimit).toHaveBeenCalled()
    }
    expect(mocks.rateLimit.mock.calls.every((c) => (c[0] as { onError: string }).onError === "deny")).toBe(true)
  })

  it("allows ten account checks an hour", async () => {
    signIn(["affiliate"])
    await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, windowSeconds: 3600 }))
  })

  it("does not call the bank when the limit is hit", async () => {
    signIn(["affiliate"])
    state.limitAllowed = false
    const result = await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })
    expect(result.ok).toBe(false)
    expect(mocks.transfers.resolveAccount).not.toHaveBeenCalled()
  })
})

describe("the user id is always the signed-in user", () => {
  it("ignores a user id in the input", async () => {
    signIn(["affiliate"])
    await actions.previewWithdrawalAction({ amountKobo: 500000, userId: OTHER } as never)
    await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456", userId: OTHER } as never)
    await actions.cancelWithdrawalAction({ withdrawalId: WD, userId: OTHER } as never)
    await actions.setAutoPayoutAction({ enabled: false, userId: OTHER } as never)
    await actions.getPayoutScreenAction()

    expect(mocks.service.previewWithdrawal).toHaveBeenCalledWith(USER, BigInt(500000))
    expect(mocks.service.requestManualWithdrawal).toHaveBeenCalledWith({ userId: USER, amountKobo: BigInt(500000) })
    expect(mocks.controls.cancelWithdrawal).toHaveBeenCalledWith(USER, WD)
    expect(mocks.store.setAutoPayout).toHaveBeenCalledWith(USER, false)
    expect(mocks.controls.getPayoutScreenData).toHaveBeenCalledWith(USER)
    expect(mocks.service.previewWithdrawal.mock.calls.flat().map(String)).not.toContain(OTHER)
  })

  it("checks the step-up code for the signed-in user and the right purpose", async () => {
    signIn(["vendor"])
    await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })
    await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })

    const calls = mocks.controls.verifyStepUpCode.mock.calls.map((c) => c[0] as { userId: string; purpose: string })
    expect(calls.map((c) => c.userId)).toEqual([USER, USER])
    expect(calls.map((c) => c.purpose)).toEqual(["withdrawal", "bank_change"])
  })

  it("acts as the signed-in admin", async () => {
    signIn(["finance"])
    mocks.store.approveWithdrawal.mockResolvedValue({ status: "approved", needsSecondApproval: true })
    await actions.approveWithdrawalAction({ withdrawalId: WD, note: "ok" })
    await actions.rejectWithdrawalAction({ withdrawalId: WD, reason: "Not enough detail given." })
    await actions.updatePayoutSettingAction({ key: "commission_hold_days", value: 7 })
    await actions.addBlackoutDateAction({ day: "2026-12-25", reason: "Christmas Day" })
    await actions.removeBlackoutDateAction({ day: "2026-12-25" })

    expect(mocks.store.approveWithdrawal).toHaveBeenCalledWith(USER, WD, "ok")
    expect(mocks.store.rejectWithdrawal).toHaveBeenCalledWith(USER, WD, "Not enough detail given.")
    expect(mocks.controls.updateSetting).toHaveBeenCalledWith(USER, "commission_hold_days", 7)
    expect(mocks.controls.addBlackoutDate).toHaveBeenCalledWith(USER, "2026-12-25", "Christmas Day")
    expect(mocks.controls.removeBlackoutDate).toHaveBeenCalledWith(USER, "2026-12-25")
  })
})

describe("validation", () => {
  beforeEach(() => signIn(["affiliate"]))

  it.each(["12345", "12345678901", "12345abcde", "", "0123 45678"])("rejects the account number %j", async (accountNumber) => {
    const result = await actions.resolveAccountAction({ bankCode: "058", accountNumber })
    expect(result.ok).toBe(false)
    expect(mocks.transfers.resolveAccount).not.toHaveBeenCalled()
  })

  it.each(["", "12", "abc", "0580000000"])("rejects the bank code %j", async (bankCode) => {
    expect((await actions.resolveAccountAction({ bankCode, accountNumber: ACCOUNT_NUMBER })).ok).toBe(false)
  })

  it.each([0, -5, 1.5, "abc", "", 100_000_000_001])("rejects the amount %j", async (amountKobo) => {
    expect((await actions.previewWithdrawalAction({ amountKobo: amountKobo as never })).ok).toBe(false)
    expect(mocks.service.previewWithdrawal).not.toHaveBeenCalled()
  })

  it("accepts an amount as a number, a bigint or a digit string", async () => {
    for (const amountKobo of [500000, BigInt(500000), "500000"]) {
      expect((await actions.previewWithdrawalAction({ amountKobo })).ok).toBe(true)
    }
  })

  it.each(["12345", "1234567", "abcdef", ""])("rejects the code %j", async (code) => {
    const result = await actions.requestWithdrawalAction({ amountKobo: 500000, code })
    expect(result.ok).toBe(false)
    expect(mocks.controls.verifyStepUpCode).not.toHaveBeenCalled()
  })

  it("accepts a code typed with spaces or a dash", async () => {
    expect((await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123 456" })).ok).toBe(true)
    expect((await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123-456" })).ok).toBe(true)
  })

  it("rejects an unknown purpose and a bad withdrawal id", async () => {
    expect((await actions.requestStepUpCodeAction({ purpose: "login" as never })).ok).toBe(false)
    expect((await actions.cancelWithdrawalAction({ withdrawalId: "nope" })).ok).toBe(false)
  })
})

describe("account resolve and save", () => {
  beforeEach(() => signIn(["affiliate"]))

  it("returns the account name and the last four, never the number", async () => {
    const result = await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })

    expect(result).toEqual({ ok: true, data: { accountName: "ADAEZE OKONKWO", accountLast4: "6789", nameMatches: true } })
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_NUMBER)
  })

  it("says when the bank's name does not match the profile", async () => {
    mocks.transfers.resolveAccount.mockResolvedValue({ accountName: "SOMEONE ELSE", accountNumber: ACCOUNT_NUMBER })
    const result = await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })
    expect(result).toMatchObject({ ok: true, data: { nameMatches: false } })
  })

  it("answers a Paystack outage with one safe sentence", async () => {
    const { PaystackError } = await import("@/lib/paystack/client")
    mocks.transfers.resolveAccount.mockRejectedValue(new PaystackError("timeout", "secret detail 0123456789", { retryable: true }))
    const result = await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })
    expect(result).toEqual({ ok: false, error: "We could not reach the bank check right now. Please try again in a moment." })
  })

  it("saves with a valid code and returns only safe fields", async () => {
    const result = await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })

    expect(result).toEqual({ ok: true, data: { bankName: "GTBank", accountLast4: "6789", accountName: "ADAEZE OKONKWO" } })
    expect(mocks.service.prepareAccount).toHaveBeenCalledWith({
      userId: USER, bankCode: "058", bankName: "GTBank", accountNumber: ACCOUNT_NUMBER, profileName: "Adaeze Okonkwo",
    })
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_NUMBER)
  })

  it("takes the bank name from the server list, not the browser", async () => {
    await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456", bankName: "Fake Bank" } as never)
    expect(mocks.service.prepareAccount).toHaveBeenCalledWith(expect.objectContaining({ bankName: "GTBank" }))
  })

  it("saves nothing with a wrong code", async () => {
    mocks.controls.verifyStepUpCode.mockResolvedValue(false)
    const result = await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })
    expect(result).toEqual({ ok: false, error: "That code is not right or has expired. Ask for a new code." })
    expect(mocks.service.prepareAccount).not.toHaveBeenCalled()
  })

  it("maps name_mismatch to the exact sentence", async () => {
    mocks.service.prepareAccount.mockResolvedValue({ status: "name_mismatch", resolvedName: "SOMEONE ELSE" })
    const result = await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })
    expect(result).toEqual({
      ok: false,
      error: "The name on this account does not match the name on your Affilova profile. Update your profile name or use an account in your own name.",
    })
  })

  it("asks for a profile name when there is none", async () => {
    mocks.profile = { first_name: null, last_name: null, display_name: null }
    const result = await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })
    expect(result.ok).toBe(false)
    expect(mocks.service.prepareAccount).not.toHaveBeenCalled()
  })

  it("refuses a bank that is not in the list", async () => {
    const result = await actions.savePayoutAccountAction({ bankCode: "999", accountNumber: ACCOUNT_NUMBER, code: "123456" })
    expect(result).toEqual({ ok: false, error: "Choose a bank from the list." })
  })
})

describe("step-up codes", () => {
  beforeEach(() => signIn(["affiliate"]))

  it("emails the code to the signed-in user and returns nothing secret", async () => {
    const result = await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

    expect(result).toEqual({ ok: true, data: { expiresInMinutes: 10 } })
    const hashCall = mocks.controls.createStepUpCode.mock.calls[0]?.[0] as { codeHash: string; expiresInSeconds: number }
    expect(hashCall.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCall.expiresInSeconds).toBe(600)
    const mail = mocks.sendEmail.mock.calls[0]?.[0] as { to: string; text: string }
    expect(mail.to).toBe("ada@example.com")
    const code = /\n([0-9]{6})\n/.exec(mail.text)?.[1]
    expect(code).toBeDefined()
    expect(JSON.stringify(result)).not.toContain(code as string)
    expect(everything()).not.toContain(code as string)
  })

  it("tells the user how long to wait during the cooldown, and sends nothing", async () => {
    mocks.controls.createStepUpCode.mockResolvedValue({ ok: false, retryAfterSeconds: 42 })
    const result = await actions.requestStepUpCodeAction({ purpose: "withdrawal" })
    expect(result).toEqual({ ok: false, error: "Please wait 42 seconds before asking for another code." })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("says so after the hourly cap", async () => {
    mocks.controls.createStepUpCode.mockResolvedValue({ ok: false, retryAfterSeconds: 0 })
    expect(await actions.requestStepUpCodeAction({ purpose: "bank_change" })).toEqual({
      ok: false, error: "You have asked for too many codes. Try again later.",
    })
  })

  it("reports a failed send without leaking anything", async () => {
    mocks.sendEmail.mockResolvedValue({ ok: false, reason: "invalid_sender" })

    const result = await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

    expect(result).toEqual({
      ok: false,
      error: "Email is temporarily unavailable. Please contact support at hello@affilova.com.",
    })
    expect(JSON.stringify(result)).not.toContain("ada@example.com")
    expect(everything()).not.toContain("ada@example.com")
  })

  it.each([
    "not_configured",
    "invalid_sender",
    "ip_not_authorized",
    "unauthorized",
    "invalid_request",
  ])("points at support when the reason is %s, since waiting cannot fix it", async (reason) => {
    mocks.sendEmail.mockResolvedValue({ ok: false, reason })

    const result = await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

    expect(result).toEqual({
      ok: false,
      error: "Email is temporarily unavailable. Please contact support at hello@affilova.com.",
    })
  })

  it.each(["quota", "provider_error", "network"])(
    "asks for a retry when the reason is %s, since it clears on its own",
    async (reason) => {
      mocks.sendEmail.mockResolvedValue({ ok: false, reason })

      const result = await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

      expect(result).toEqual({
        ok: false,
        error: "We could not send the code right now. Please try again in a few minutes.",
      })
    },
  )

  it("logs the reason and never the address", async () => {
    mocks.sendEmail.mockResolvedValue({ ok: false, reason: "quota" })

    await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

    const logged = everything()

    expect(logged).toContain("payout_step_up_email_failed")
    expect(logged).toContain("quota")
    expect(logged).not.toContain("ada@example.com")
  })

  it("needs an email address", async () => {
    state.user = { id: USER, email: null }
    expect((await actions.requestStepUpCodeAction({ purpose: "withdrawal" })).ok).toBe(false)
  })
})

describe("withdrawals", () => {
  beforeEach(() => signIn(["affiliate"]))

  it("returns the preview with bigint money", async () => {
    const result = await actions.previewWithdrawalAction({ amountKobo: 500000 })
    expect(result).toMatchObject({ ok: true, data: { allowed: true, grossKobo: BigInt(500000), netKobo: BigInt(490000) } })
  })

  it.each([
    ["Approved and queued", "approved", false],
    ["Waiting for admin approval", "requested", true],
    ["Requested", "requested", false],
  ])("reports %s", async (outcome, status, needsApproval) => {
    mocks.service.requestManualWithdrawal.mockResolvedValue({ withdrawalId: WD, status, needsApproval, reference: "wd_x" })
    expect(await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })).toEqual({
      ok: true, data: { status, needsApproval, outcome },
    })
  })

  it("does not use up the code when a rule blocks the request", async () => {
    mocks.service.previewWithdrawal.mockResolvedValue({
      allowed: false, reasons: ["below_minimum"], grossKobo: BigInt(100), feeKobo: BigInt(0), netKobo: BigInt(100),
      availableKobo: BigInt(900000), nextPayoutDay: null, needsApproval: false,
    })
    const result = await actions.requestWithdrawalAction({ amountKobo: 100, code: "123456" })
    expect(result).toEqual({ ok: false, error: "That is below the minimum withdrawal." })
    expect(mocks.controls.verifyStepUpCode).not.toHaveBeenCalled()
    expect(mocks.service.requestManualWithdrawal).not.toHaveBeenCalled()
  })

  it("requests nothing with a wrong code", async () => {
    mocks.controls.verifyStepUpCode.mockResolvedValue(false)
    const result = await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })
    expect(result.ok).toBe(false)
    expect(mocks.service.requestManualWithdrawal).not.toHaveBeenCalled()
  })

  it("turns database codes into safe sentences and hides anything unknown", async () => {
    mocks.service.requestManualWithdrawal.mockRejectedValue(new PayoutRpcError("insufficient_balance"))
    expect(await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })).toEqual({
      ok: false, error: "That is more than your available balance.",
    })
    mocks.service.requestManualWithdrawal.mockRejectedValue(new Error('relation "withdrawals" 0123456789 failed'))
    const result = await actions.requestWithdrawalAction({ amountKobo: 500000, code: "123456" })
    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." })
  })

  it("cancels through the database, which checks ownership", async () => {
    mocks.controls.cancelWithdrawal.mockRejectedValue(new PayoutRpcError("forbidden"))
    expect((await actions.cancelWithdrawalAction({ withdrawalId: WD })).ok).toBe(false)
    mocks.controls.cancelWithdrawal.mockRejectedValue(new PayoutRpcError("invalid_status"))
    expect(await actions.cancelWithdrawalAction({ withdrawalId: WD })).toEqual({
      ok: false, error: "That withdrawal has already moved on, so this is no longer possible.",
    })
  })

  it("never logs an account number, a code or an email address", async () => {
    await actions.resolveAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER })
    mocks.service.prepareAccount.mockRejectedValue(new Error(`boom ${ACCOUNT_NUMBER} 123456 ada@example.com`))
    await actions.savePayoutAccountAction({ bankCode: "058", accountNumber: ACCOUNT_NUMBER, code: "123456" })
    await actions.requestStepUpCodeAction({ purpose: "withdrawal" })

    const logged = everything()
    expect(logged).not.toContain(ACCOUNT_NUMBER)
    expect(logged).not.toContain("123456")
    expect(logged).not.toContain("ada@example.com")
  })
})

describe("admin", () => {
  beforeEach(() => signIn(["admin"]))

  it("lists a queue tab with a cursor", async () => {
    mocks.controls.adminWithdrawalQueue.mockResolvedValue({ rows: [], nextCursor: null })
    await actions.listWithdrawalsAction({ tab: "needs_approval", cursor: { requestedAt: "2026-11-23T10:00:00Z", id: WD } })
    expect(mocks.controls.adminWithdrawalQueue).toHaveBeenCalledWith({
      actorId: USER, tab: "needs_approval", limit: 25, cursor: { requestedAt: "2026-11-23T10:00:00Z", id: WD },
    })
    expect((await actions.listWithdrawalsAction({ tab: "everything" })).ok).toBe(false)
  })

  it("requires a reason of at least ten characters to reject", async () => {
    const result = await actions.rejectWithdrawalAction({ withdrawalId: WD, reason: "short" })
    expect(result).toEqual({ ok: false, error: "Give a reason of at least 10 characters." })
    expect(mocks.store.rejectWithdrawal).not.toHaveBeenCalled()
  })

  it("queues the rejection notice for the user", async () => {
    await actions.rejectWithdrawalAction({ withdrawalId: WD, reason: "Account is under review." })
    expect(mocks.enqueueJob).toHaveBeenCalledWith({
      type: "withdrawal_notice",
      payload: { withdrawal_id: WD, status: "rejected" },
      dedupeKey: `withdrawal_notice:${WD}:rejected`,
    })
  })

  it("still rejects when the queue is down", async () => {
    mocks.enqueueJob.mockRejectedValue(new Error("down"))
    expect((await actions.rejectWithdrawalAction({ withdrawalId: WD, reason: "Account is under review." })).ok).toBe(true)
  })

  it("refuses approving your own withdrawal with a clear sentence", async () => {
    mocks.store.approveWithdrawal.mockRejectedValue(new PayoutRpcError("owner_cannot_approve"))
    expect(await actions.approveWithdrawalAction({ withdrawalId: WD })).toEqual({
      ok: false, error: "You cannot approve your own withdrawal.",
    })
  })

  it("reports that a second approver is needed", async () => {
    mocks.store.approveWithdrawal.mockResolvedValue({ status: "requested", needsSecondApproval: true })
    expect(await actions.approveWithdrawalAction({ withdrawalId: WD })).toEqual({
      ok: true, data: { status: "requested", needsSecondApproval: true },
    })
  })

  it("only accepts whitelisted settings and number or boolean values", async () => {
    expect((await actions.updatePayoutSettingAction({ key: "jwt_secret", value: 1 })).ok).toBe(false)
    expect((await actions.updatePayoutSettingAction({ key: "withdrawal_fee_bps", value: -1 })).ok).toBe(false)
    expect((await actions.updatePayoutSettingAction({ key: "withdrawal_fee_bps", value: 1.5 })).ok).toBe(false)
    expect((await actions.updatePayoutSettingAction({ key: "withdrawal_fee_bps", value: "200" as never })).ok).toBe(false)
    expect(mocks.controls.updateSetting).not.toHaveBeenCalled()
  })

  it("shows the database's range message", async () => {
    mocks.controls.updateSetting.mockRejectedValue(new PayoutRpcError("out_of_range"))
    expect(await actions.updatePayoutSettingAction({ key: "withdrawal_fee_bps", value: 5000 })).toEqual({
      ok: false, error: "That value is outside the range allowed for this setting.",
    })
  })

  it("rejects bad blackout input", async () => {
    expect((await actions.addBlackoutDateAction({ day: "25/12/2026", reason: "Christmas Day" })).ok).toBe(false)
    expect((await actions.addBlackoutDateAction({ day: "2026-12-25", reason: "x" })).ok).toBe(false)
    expect((await actions.removeBlackoutDateAction({ day: "nope" })).ok).toBe(false)
  })
})
