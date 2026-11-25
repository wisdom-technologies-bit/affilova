import { describe, expect, it, vi } from "vitest"

import {
  runWithdrawalNoticeJob,
  type WithdrawalForNotice,
  type WithdrawalNoticeDeps,
  type WithdrawalNoticeLog,
} from "./withdrawal-notice"

const branding = { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" }

function withdrawal(overrides: Partial<WithdrawalForNotice> = {}): WithdrawalForNotice {
  return {
    id: "w-1",
    status: "paid",
    grossKobo: BigInt(500000),
    feeKobo: BigInt(10000),
    netKobo: BigInt(490000),
    reason: null,
    email: "Ada@Example.com",
    ...overrides,
  }
}

function setup(row: WithdrawalForNotice | null, options: { owned?: boolean; sendOk?: boolean } = {}) {
  const claims: string[] = []
  const log: WithdrawalNoticeLog = {
    claim: vi.fn(async (kind: string) => {
      claims.push(kind)
      return options.owned !== false
    }),
    markSent: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  const send = vi.fn(async () =>
    options.sendOk === false ? ({ ok: false } as never) : ({ ok: true, messageId: "m-1" } as never),
  )
  const read = vi.fn(async () => row)
  const deps: WithdrawalNoticeDeps = { read, send, log, branding }

  return { deps, log, send, read, claims }
}

describe("runWithdrawalNoticeJob", () => {
  it("sends one notice and records it", async () => {
    const { deps, send, log, claims } = setup(withdrawal())

    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, deps)

    expect(claims).toEqual(["withdrawal_paid"])
    expect(send).toHaveBeenCalledTimes(1)
    expect(log.markSent).toHaveBeenCalledWith("withdrawal_paid", "w-1", expect.stringMatching(/^[0-9a-f]{32}$/), "m-1")
  })

  it("reads by reference when the webhook only knows the reference", async () => {
    const { deps, read } = setup(withdrawal())

    await runWithdrawalNoticeJob({ reference: "wd_abc", status: "paid" }, deps)

    expect(read).toHaveBeenCalledWith({ reference: "wd_abc" })
  })

  it("sends nothing when the email is already claimed", async () => {
    const { deps, send } = setup(withdrawal(), { owned: false })

    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, deps)

    expect(send).not.toHaveBeenCalled()
  })

  it("gives the claim back and throws when the send fails, so the queue retries", async () => {
    const { deps, log } = setup(withdrawal(), { sendOk: false })

    await expect(runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, deps)).rejects.toThrow(
      "email_send_failed:withdrawal_paid",
    )
    expect(log.release).toHaveBeenCalledTimes(1)
  })

  it("sends nothing when the withdrawal is no longer in the status the job names", async () => {
    const { deps, send } = setup(withdrawal({ status: "reversed" }))

    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, deps)

    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: "paid" }],
    [{ withdrawal_id: "w-1" }],
    [{ withdrawal_id: "w-1", status: "processing" }],
    [{ withdrawal_id: " ", status: "paid" }],
  ])("ignores a bad payload %j", async (payload) => {
    const { deps, send, read } = setup(withdrawal())

    await runWithdrawalNoticeJob(payload, deps)

    expect(read).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("does nothing for a missing withdrawal or a user with no email", async () => {
    const missing = setup(null)
    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, missing.deps)
    expect(missing.send).not.toHaveBeenCalled()

    const noEmail = setup(withdrawal({ email: null }))
    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "paid" }, noEmail.deps)
    expect(noEmail.send).not.toHaveBeenCalled()
  })

  it("puts the reason only in a rejection notice and no account number anywhere", async () => {
    const { deps, send } = setup(withdrawal({ status: "rejected", reason: "Account under review." }))

    await runWithdrawalNoticeJob({ withdrawal_id: "w-1", status: "rejected" }, deps)

    const sent = JSON.stringify(send.mock.calls)
    expect(sent).toContain("Account under review.")
    expect(sent).not.toMatch(/[0-9]{10}/)
  })
})
