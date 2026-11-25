import { createElement, type ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// What the payout panels put on the page.
//
// Render tests, not browser tests: each panel is rendered to static markup with
// real props, in every state it can be in, and the test reads what a person
// would read. Nothing here reaches a database or a server action.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

vi.mock("@/lib/payouts/actions", () => ({
  getPayoutScreenAction: vi.fn(),
  listBanksAction: vi.fn(),
  resolveAccountAction: vi.fn(),
  requestStepUpCodeAction: vi.fn(),
  savePayoutAccountAction: vi.fn(),
  previewWithdrawalAction: vi.fn(),
  requestWithdrawalAction: vi.fn(),
  cancelWithdrawalAction: vi.fn(),
  setAutoPayoutAction: vi.fn(),
  listWithdrawalsAction: vi.fn(),
  approveWithdrawalAction: vi.fn(),
  rejectWithdrawalAction: vi.fn(),
  listBlackoutDatesAction: vi.fn(),
  addBlackoutDateAction: vi.fn(),
  removeBlackoutDateAction: vi.fn(),
  getPayoutSettingsAction: vi.fn(),
  updatePayoutSettingAction: vi.fn(),
}))

import { AdminWithdrawalsQueue } from "./admin-withdrawals"
import { BlackoutDatesPanel } from "./blackout-dates-panel"
import { PayoutDetailsPanel } from "./payout-details-panel"
import { PayoutSettingsPanel } from "./payout-settings-panel"
import { WithdrawPanel } from "./withdraw-panel"
import { WithdrawalHistory } from "./withdrawal-history"
import type {
  AdminQueuePage,
  AdminQueueRow,
  BankOption,
  PayoutScreenData,
  PayoutSettingsSnapshot,
  ScreenWithdrawal,
  WithdrawalPreviewView,
} from "@/lib/payouts/screen-types"

const BANKS: readonly BankOption[] = [
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Zenith Bank", code: "057" },
]

const SCREEN: PayoutScreenData = {
  account: {
    bankName: "Access Bank",
    accountLast4: "4821",
    accountName: "Ada Lovelace",
    frozenUntil: null,
  },
  autoPayout: true,
  availableKobo: BigInt(4_500_000),
  pendingKobo: BigInt(1_200_000),
  totalKobo: BigInt(5_700_000),
  today: "2026-11-25",
  nextPayoutDay: "2026-11-26",
  todayIsPayoutDay: true,
  blackoutReason: null,
  settings: {
    minWithdrawalKobo: BigInt(100_000),
    feeBps: 100,
    feeMinKobo: BigInt(5_000),
    feeCapKobo: BigInt(250_000),
    holdDays: 7,
  },
  withdrawals: [],
}

const NO_ACCOUNT: PayoutScreenData = {
  ...SCREEN,
  account: null,
  autoPayout: false,
}

const FROZEN: PayoutScreenData = {
  ...SCREEN,
  account: {
    bankName: "Zenith Bank",
    accountLast4: "9012",
    accountName: "Ada Lovelace",
    frozenUntil: "2026-11-28T09:15:00.000Z",
  },
}

const PREVIEW_OK: WithdrawalPreviewView = {
  allowed: true,
  reasons: [],
  grossKobo: BigInt(1_000_000),
  feeKobo: BigInt(10_000),
  netKobo: BigInt(990_000),
  availableKobo: BigInt(4_500_000),
  nextPayoutDay: "2026-11-26",
  needsApproval: false,
}

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props))
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

describe("the payout details panel", () => {
  it("asks for an account when there is none, and never shows a number field first", () => {
    const html = render(PayoutDetailsPanel, {
      data: NO_ACCOUNT,
      banks: BANKS,
      withdrawalsHref: "/withdrawals",
    })

    expect(text(html)).toContain("You have not added a payout account yet. Add one below to withdraw.")
    expect(text(html)).toContain("Find your bank")
    expect(html).toMatch(/inputmode="numeric"/i)
    expect(html).toMatch(/maxlength="10"/i)
    // The switch cannot be used until there is somewhere to send money.
    expect(html).toContain("Add a payout account to switch this on.")
    expect(html).toContain("disabled")
  })

  it("shows a saved account as bank, last four digits and name", () => {
    const html = render(PayoutDetailsPanel, { data: SCREEN, banks: BANKS, withdrawalsHref: "/withdrawals" })
    const words = text(html)

    expect(words).toContain("Ada Lovelace")
    expect(words).toContain("Access Bank, account ending 4821")
    expect(words).toContain("Change account")
    expect(words).toContain("Changing it needs a code we email you, and pauses withdrawals for 72 hours.")
  })

  it("says when the 72 hour freeze ends, in Lagos time", () => {
    const words = text(render(PayoutDetailsPanel, { data: FROZEN, banks: BANKS }))

    expect(words).toContain("Withdrawals are paused until the wait ends")
    expect(words).toContain("28 Nov 2026, 10:15")
    expect(words).toContain("72 hours after a change")
    expect(words).toContain("You can still see your balance and your history.")
  })

  it("explains the automatic payout schedule, the next payout day and the fee", () => {
    const words = text(render(PayoutDetailsPanel, { data: SCREEN, banks: BANKS }))

    expect(words).toContain("Payouts run Monday to Friday, except on days we have paused them.")
    expect(words).toContain("minimum of ₦1,000")
    expect(words).toContain("fee of 1%, at least ₦50 and at most ₦2,500")
    expect(words).toContain("Commission is held for 7 days")
    expect(words).toContain("Today is a payout day.")
    expect(words).toContain("Next payout day: 26 Nov 2026")
    expect(words).toContain("On.")
  })

  it("says when automatic payout is off", () => {
    const html = render(PayoutDetailsPanel, { data: { ...SCREEN, autoPayout: false }, banks: BANKS })

    expect(text(html)).toContain("Off.")
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
  })

  it("says when automatic payout is on", () => {
    const html = render(PayoutDetailsPanel, { data: SCREEN, banks: BANKS })

    expect(html).toContain('aria-checked="true"')
    expect(text(html)).toContain("On.")
  })

  it("shows the blackout reason when today is blocked", () => {
    const words = text(
      render(PayoutDetailsPanel, {
        data: {
          ...SCREEN,
          todayIsPayoutDay: false,
          blackoutReason: "Public holiday for the election",
          nextPayoutDay: "2026-11-27",
        },
        banks: BANKS,
      }),
    )

    expect(words).toContain("Payouts are paused today")
    expect(words).toContain("Public holiday for the election. Payouts continue on the next payout day.")
    expect(words).toContain("Next payout day: 27 Nov 2026")
  })

  it("says that weekends are not payout days", () => {
    const words = text(
      render(PayoutDetailsPanel, {
        data: {
          ...SCREEN,
          today: "2026-11-28",
          todayIsPayoutDay: false,
          blackoutReason: null,
          nextPayoutDay: "2026-11-30",
        },
        banks: BANKS,
      }),
    )

    expect(words).toContain("No payouts on weekends")
    expect(words).toContain("Payouts run Monday to Friday. Your next payout day is shown above.")
    expect(words).toContain("Next payout day: 30 Nov 2026")
  })

  it("says the bank list could not be loaded, and does not offer a bank select", () => {
    const html = render(PayoutDetailsPanel, {
      data: NO_ACCOUNT,
      banks: null,
      banksError: "We could not load the banks. Refresh the page to try again.",
    })

    expect(text(html)).toContain("We could not load the banks. Refresh the page to try again.")
    expect(html).not.toContain('id="bank-select"')
  })

  it("shows the resolved name and asks for confirmation before a code", () => {
    const words = text(
      render(PayoutDetailsPanel, {
        data: NO_ACCOUNT,
        banks: BANKS,
        initialFlow: {
          bankCode: "044",
          accountNumber: "0123456789",
          resolved: { accountName: "Ada Lovelace", accountLast4: "6789", nameMatches: true },
        },
      }),
    )

    expect(words).toContain("The bank says this account belongs to:")
    expect(words).toContain("Ada Lovelace")
    expect(words).toContain("Account ending 6789")
    expect(words).toContain("Yes, this is my account and the name is right.")
    expect(words).toContain("Use a different account")
    // The full number is never put back on the page.
    expect(words).not.toContain("0123456789")
  })

  it("refuses a name that does not match the profile, in the exact words", () => {
    const words = text(
      render(PayoutDetailsPanel, {
        data: NO_ACCOUNT,
        banks: BANKS,
        initialFlow: {
          bankCode: "044",
          accountNumber: "0123456789",
          resolved: { accountName: "Chidi Okeke", accountLast4: "6789", nameMatches: false },
        },
      }),
    )

    expect(words).toContain(
      "The name on this account does not match the name on your Affilova profile. Update your profile name or use an account in your own name.",
    )
    expect(words).not.toContain("Yes, this is my account and the name is right.")
  })

  it("asks for the emailed code once the name is confirmed", () => {
    const html = render(PayoutDetailsPanel, {
      data: NO_ACCOUNT,
      banks: BANKS,
      initialFlow: {
        bankCode: "044",
        accountNumber: "0123456789",
        resolved: { accountName: "Ada Lovelace", accountLast4: "6789", nameMatches: true },
        confirmed: true,
        codeRequested: true,
      },
    })

    expect(text(html)).toContain("6 digit code from your email")
    expect(text(html)).toContain("Save account")
    expect(text(html)).toContain("Send a new code")
    expect(html).toMatch(/autocomplete="one-time-code"/i)
  })

  it("shows an action error in a live region and never repeats the account number", () => {
    const html = render(PayoutDetailsPanel, {
      data: NO_ACCOUNT,
      banks: BANKS,
      initialFlow: {
        bankCode: "044",
        accountNumber: "0123456789",
        resolved: { accountName: "Ada Lovelace", accountLast4: "6789", nameMatches: true },
        confirmed: true,
        codeRequested: true,
        error: "That code is not right or has expired. Ask for a new code.",
      },
    })

    expect(html).toContain('role="alert"')
    expect(text(html)).toContain("That code is not right or has expired. Ask for a new code.")
    expect(text(html)).not.toContain("0123456789")
  })
})

describe("the withdraw panel", () => {
  it("shows the three balances and the hold behind the pending one", () => {
    const words = text(render(WithdrawPanel, { data: SCREEN, payoutDetailsHref: "/payout-details" }))

    expect(words).toContain("Available")
    expect(words).toContain("₦45,000")
    expect(words).toContain("Pending")
    expect(words).toContain("₦12,000")
    expect(words).toContain("Total")
    expect(words).toContain("₦57,000")
    expect(words).toContain("Held for 7 days after each sale.")
  })

  it("points at the payout details page when there is no account", () => {
    const words = text(render(WithdrawPanel, { data: NO_ACCOUNT, payoutDetailsHref: "/payout-details" }))

    expect(words).toContain("Add a payout account first")
    expect(words).toContain("Add your payout account")
  })

  it("explains the freeze instead of offering an amount", () => {
    const words = text(render(WithdrawPanel, { data: FROZEN, payoutDetailsHref: "/payout-details" }))

    expect(words).toContain("Withdrawals are paused after your account change")
    expect(words).toContain("They reopen after the 72 hour wait ends.")
  })

  it("shows the preview: amount, fee and what the person receives", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { amount: "10000", preview: PREVIEW_OK },
      }),
    )

    expect(words).toContain("Amount ₦10,000")
    expect(words).toContain("Fee ₦100")
    expect(words).toContain("You receive ₦9,900")
    expect(words).toContain("Email me a code")
  })

  it("says the amount is below the minimum", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { amount: "50" },
      }),
    )

    expect(words).toContain("The minimum withdrawal is ₦1,000.")
    expect(words).not.toContain("Email me a code")
  })

  it("says the amount is more than the available balance", () => {
    const words = text(
      render(WithdrawPanel, {
        data: { ...SCREEN, availableKobo: BigInt(100_000) },
        payoutDetailsHref: "/payout-details",
        initial: { amount: "5000" },
      }),
    )

    expect(words).toContain("That is more than your available balance of ₦1,000.")
  })

  it("lists every blocked rule the server gives, in plain words", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: {
          amount: "10000",
          preview: {
            ...PREVIEW_OK,
            allowed: false,
            reasons: ["account_frozen", "daily_limit", "something_new"],
          },
        },
      }),
    )

    expect(words).toContain("Your payout account was changed recently.")
    expect(words).toContain("That is over today's withdrawal limit.")
    expect(words).toContain("This withdrawal cannot be requested right now.")
    expect(words).not.toContain("Email me a code")
  })

  it("says when the amount needs approval before it is sent", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { amount: "10000", preview: { ...PREVIEW_OK, needsApproval: true } },
      }),
    )

    expect(words).toContain("This amount needs a quick approval from our team before it is sent.")
  })

  it("shows the code step after a code is requested", () => {
    const html = render(WithdrawPanel, {
      data: SCREEN,
      payoutDetailsHref: "/payout-details",
      initial: { amount: "10000", preview: PREVIEW_OK, codeRequested: true },
    })

    expect(text(html)).toContain("6 digit code from your email")
    expect(text(html)).toContain("Request withdrawal")
    expect(html).toMatch(/autocomplete="one-time-code"/i)
  })

  for (const [outcome, explanation] of [
    ["Requested", "We have your request. You will get an email when it is paid."],
    [
      "Approved and queued",
      "It is approved and will be sent on the next payout run. You will get an email when it is paid.",
    ],
    [
      "Waiting for admin approval",
      "A member of our team has to approve this amount before it is sent. You will get an email either way.",
    ],
  ] as const) {
    it(`shows the result "${outcome}"`, () => {
      const html = render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { result: { status: "requested", needsApproval: false, outcome } },
      })

      expect(text(html)).toContain(outcome)
      expect(text(html)).toContain(explanation)
      expect(text(html)).toContain("Make another withdrawal")
      expect(html).toContain('aria-live="polite"')
    })
  }

  it("shows a preview error from the server", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { amount: "10000", previewError: "We could not check that amount. Please try again." },
      }),
    )

    expect(words).toContain("We could not check that amount. Please try again.")
  })

  it("tells the person when a request failed", () => {
    const words = text(
      render(WithdrawPanel, {
        data: SCREEN,
        payoutDetailsHref: "/payout-details",
        initial: { amount: "10000", preview: PREVIEW_OK, codeRequested: true, error: "That code is not right or has expired. Ask for a new code." },
      }),
    )

    expect(words).toContain("That code is not right or has expired. Ask for a new code.")
  })

  it("notes a blackout day and still allows a request", () => {
    const words = text(
      render(WithdrawPanel, {
        data: { ...SCREEN, todayIsPayoutDay: false, blackoutReason: "Public holiday", nextPayoutDay: "2026-11-27" },
        payoutDetailsHref: "/payout-details",
        initial: { amount: "10000", preview: PREVIEW_OK },
      }),
    )

    expect(words).toContain("Payouts are paused today")
    expect(words).toContain("You can still ask now; it is sent on the next payout day.")
    expect(words).toContain("Email me a code")
  })
})

const WITHDRAWALS: readonly ScreenWithdrawal[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "manual",
    status: "requested",
    grossKobo: BigInt(1_000_000),
    feeKobo: BigInt(10_000),
    netKobo: BigInt(990_000),
    requestedAt: "2026-11-24T09:00:00.000Z",
    paidAt: null,
    reason: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "auto",
    status: "paid",
    grossKobo: BigInt(500_000),
    feeKobo: BigInt(5_000),
    netKobo: BigInt(495_000),
    requestedAt: "2026-11-20T09:00:00.000Z",
    paidAt: "2026-11-21T09:00:00.000Z",
    reason: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "manual",
    status: "rejected",
    grossKobo: BigInt(200_000),
    feeKobo: BigInt(5_000),
    netKobo: BigInt(195_000),
    requestedAt: "2026-11-18T09:00:00.000Z",
    paidAt: null,
    reason: "The account name did not match your profile.",
  },
]

describe("the withdrawal history", () => {
  it("says there is nothing yet, in words rather than a blank table", () => {
    const words = text(render(WithdrawalHistory, { withdrawals: [] }))

    expect(words).toContain("No withdrawals yet.")
  })

  it("shows each status as a word and a kind, never a colour alone", () => {
    const html = render(WithdrawalHistory, { withdrawals: WITHDRAWALS })
    const words = text(html)

    expect(words).toContain("Requested")
    expect(words).toContain("Paid")
    expect(words).toContain("Rejected, money returned")
    expect(words).toContain("Automatic")
    expect(words).toContain("Requested by you")
    expect(words).toContain("₦10,000")
    expect(words).toContain("₦9,900")
    expect(words).toContain("24 Nov 2026, 10:00")
    expect(words).toContain("Reason: The account name did not match your profile.")
    // One card per row on a phone, so the table is not the only shape.
    expect(html).toContain("md:block")
    expect(html).toContain("md:hidden")
  })

  it("offers Cancel only on a request that can still be cancelled", () => {
    const html = render(WithdrawalHistory, { withdrawals: WITHDRAWALS })

    // One button per shape: the table on a wide screen and the card on a phone.
    expect(text(html).match(/Cancel/g) ?? []).toHaveLength(2)
    expect(text(html)).not.toContain("Cancel it")
  })

  it("asks once before cancelling", () => {
    const words = text(
      render(WithdrawalHistory, {
        withdrawals: WITHDRAWALS,
        initialConfirming: "11111111-1111-4111-8111-111111111111",
      }),
    )

    expect(words).toContain("Yes, cancel it")
    expect(words).toContain("Keep it")
  })

  it("shows a cancel error", () => {
    const words = text(
      render(WithdrawalHistory, {
        withdrawals: WITHDRAWALS,
        initialError: "That withdrawal has already moved on, so this is no longer possible.",
      }),
    )

    expect(words).toContain("That withdrawal has already moved on, so this is no longer possible.")
  })
})

function queueRow(overrides: Partial<AdminQueueRow>): AdminQueueRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "user-1",
    kind: "manual",
    status: "requested",
    grossKobo: BigInt(2_500_000),
    feeKobo: BigInt(25_000),
    netKobo: BigInt(2_475_000),
    requestedAt: "2026-11-24T09:00:00.000Z",
    paidAt: null,
    failureReason: null,
    bankName: "Access Bank",
    accountLast4: "4821",
    accountName: "Ada Lovelace",
    isFirst: false,
    hasRiskFlag: false,
    approvals: 0,
    needsTwoApprovers: false,
    needsSecondApprover: false,
    firstApprover: null,
    ...overrides,
  }
}

function queuePage(rows: readonly AdminQueueRow[]): AdminQueuePage {
  return { rows, nextCursor: null }
}

describe("the admin withdrawal queue", () => {
  it("offers the four tabs with the agreed names", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "needs_approval",
        initialPage: queuePage([]),
      }),
    )

    expect(words).toContain("Needs approval")
    expect(words).toContain("Approved and processing")
    expect(words).toContain("Paid")
    expect(words).toContain("Failed or rejected")
  })

  it("says a tab is empty rather than showing nothing", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "paid",
        initialPage: queuePage([]),
      }),
    )

    expect(words).toContain("Nothing here right now.")
  })

  it("shows amount, fee, net, kind, time, account and the approval state", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "needs_approval",
        initialPage: queuePage([
          queueRow({ isFirst: true, needsTwoApprovers: true, needsSecondApprover: true, approvals: 1 }),
        ]),
      }),
    )

    expect(words).toContain("₦25,000")
    expect(words).toContain("₦250")
    expect(words).toContain("₦24,750")
    expect(words).toContain("Manual")
    expect(words).toContain("24 Nov 2026, 10:00")
    expect(words).toContain("Ada Lovelace")
    expect(words).toContain("Access Bank, ending 4821")
    expect(words).toContain("First withdrawal for this user")
    expect(words).toContain("Approvals: 1 of 2, needs a second approver")
  })

  it("marks a risk flag in words, not only with an icon", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "needs_approval",
        initialPage: queuePage([queueRow({ hasRiskFlag: true })]),
      }),
    )

    expect(words).toContain("Risk flag")
  })

  it("refuses to let a person act on their own withdrawal", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "user-1",
        initialTab: "needs_approval",
        initialPage: queuePage([queueRow({ userId: "user-1" })]),
      }),
    )

    expect(words).toContain("Your own withdrawal: someone else must approve it.")
    expect(words).not.toContain("Reject")
  })

  it("stops a second approval by the same person and says why", () => {
    const html = render(AdminWithdrawalsQueue, {
      currentUserId: "admin-1",
      initialTab: "needs_approval",
      initialPage: queuePage([queueRow({ firstApprover: "admin-1", needsTwoApprovers: true, approvals: 1 })]),
    })

    expect(text(html)).toContain("You approved this. A second approver is needed.")
    expect(html).toContain("disabled")
  })

  it("shows the failure reason on a closed withdrawal", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "closed",
        initialPage: queuePage([queueRow({ status: "failed", failureReason: "The bank refused the transfer." })]),
      }),
    )

    expect(words).toContain("Failed, money returned")
    expect(words).toContain("The bank refused the transfer.")
  })

  it("shows a load error", () => {
    const words = text(
      render(AdminWithdrawalsQueue, {
        currentUserId: "admin-1",
        initialTab: "needs_approval",
        initialPage: queuePage([]),
        initialError: "You do not have permission to do that.",
      }),
    )

    expect(words).toContain("You do not have permission to do that.")
  })
})

const SNAPSHOT: PayoutSettingsSnapshot = {
  values: {
    withdrawal_fee_bps: BigInt(100),
    withdrawal_fee_min_kobo: BigInt(5_000),
    withdrawal_fee_cap_kobo: BigInt(250_000),
    min_withdrawal_kobo: BigInt(100_000),
    withdrawal_daily_limit_kobo: BigInt(50_000_000),
    payout_auto_approve_max_kobo: BigInt(2_000_000),
    payout_dual_approval_kobo: BigInt(10_000_000),
    payout_first_requires_approval: true,
    platform_fee_bps: BigInt(750),
    commission_hold_days: BigInt(7),
    auto_payout_default: false,
  },
  changes: [
    {
      key: "withdrawal_fee_bps",
      oldValue: BigInt(50),
      newValue: BigInt(100),
      changedBy: "admin-1",
      changedAt: "2026-11-23T10:00:00.000Z",
    },
  ],
}

describe("the payout settings form", () => {
  it("shows each value the way a person reads it: naira, percent, days and a switch", () => {
    const words = text(render(PayoutSettingsPanel, { snapshot: SNAPSHOT }))

    expect(words).toContain("Fee percent")
    expect(words).toContain("Now: 1%.")
    expect(words).toContain("Now: ₦50.")
    expect(words).toContain("Now: ₦2,500.")
    expect(words).toContain("Now: ₦1,000.")
    expect(words).toContain("Now: ₦500,000.")
    expect(words).toContain("Now: 7.5%.")
    expect(words).toContain("Now: 7 days.")
    expect(words).toContain("Now: On.")
    expect(words).toContain("Now: Off.")
  })

  it("carries the range help text beside every field", () => {
    const words = text(render(PayoutSettingsPanel, { snapshot: SNAPSHOT }))

    expect(words).toContain("0% to 10%.")
    expect(words).toContain("Not above the cap.")
    expect(words).toContain("0 to 60 days.")
    expect(words).toContain("Future orders only.")
    expect(words).toContain("A person's first withdrawal always waits for approval.")
  })

  it("cannot be saved until something changes", () => {
    const html = render(PayoutSettingsPanel, { snapshot: SNAPSHOT })

    expect(text(html)).toContain("Review changes")
    expect(html).toContain("disabled")
  })

  it("lists the changes that were made, with who and when", () => {
    const words = text(render(PayoutSettingsPanel, { snapshot: SNAPSHOT }))

    expect(words).toMatch(/Fee percent\s*:\s*0\.5% to 1%/)
    expect(words).toContain("23 Nov 2026, 11:00")
  })

  it("says when nothing has been changed yet", () => {
    const words = text(render(PayoutSettingsPanel, { snapshot: { values: {}, changes: [] } }))

    expect(words).toContain("No payout settings have been changed yet.")
  })

  it("shows the error instead of an empty form when settings cannot be loaded", () => {
    const html = render(PayoutSettingsPanel, { snapshot: null, error: "Settings could not be loaded." })

    expect(text(html)).toContain("Settings could not be loaded.")
    expect(html).not.toContain("Review changes")
  })
})

describe("the blackout dates panel", () => {
  it("explains that weekends are always blocked", () => {
    const words = text(render(BlackoutDatesPanel, { days: [] }))

    expect(words).toContain("Payouts never run on Saturdays and Sundays, and you do not need to add them.")
  })

  it("says when only weekends are blocked", () => {
    const words = text(render(BlackoutDatesPanel, { days: [] }))

    expect(words).toContain("No extra blackout dates. Only weekends are blocked.")
  })

  it("lists an upcoming date with its reason", () => {
    const words = text(render(BlackoutDatesPanel, { days: [{ day: "2026-12-25", reason: "Christmas Day" }] }))

    expect(words).toContain("25 Dec 2026")
    expect(words).toContain("Christmas Day")
    expect(words).toContain("Remove")
  })

  it("shows the error instead of an empty list", () => {
    const words = text(render(BlackoutDatesPanel, { days: null, error: "The dates could not be loaded." }))

    expect(words).toContain("The dates could not be loaded.")
  })
})
