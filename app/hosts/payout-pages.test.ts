import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// What each payout route puts on the page, in the states the server can hand it.
//
// The actions are mocked: what is checked is the page a person gets when the
// screen loads, when the bank list is missing, when the queue is empty, when the
// person is not signed in, and that the merchant page carries the withdraw form
// because that app has no Withdrawals section of its own.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  redirect: vi.fn(),
}))

const payouts = vi.hoisted(() => ({
  getPayoutScreenAction: vi.fn(),
  listBanksAction: vi.fn(),
  listWithdrawalsAction: vi.fn(),
  getPayoutSettingsAction: vi.fn(),
  listBlackoutDatesAction: vi.fn(),
}))

vi.mock("@/lib/payouts/actions", () => ({
  ...payouts,
  resolveAccountAction: vi.fn(),
  requestStepUpCodeAction: vi.fn(),
  savePayoutAccountAction: vi.fn(),
  previewWithdrawalAction: vi.fn(),
  requestWithdrawalAction: vi.fn(),
  cancelWithdrawalAction: vi.fn(),
  setAutoPayoutAction: vi.fn(),
  approveWithdrawalAction: vi.fn(),
  rejectWithdrawalAction: vi.fn(),
  addBlackoutDateAction: vi.fn(),
  removeBlackoutDateAction: vi.fn(),
  updatePayoutSettingAction: vi.fn(),
}))

const session = vi.hoisted(() => ({ getAuthUser: vi.fn() }))

vi.mock("@/lib/identity/session", () => session)

import AdminSettingsPage from "@/app/hosts/admin/settings/page"
import AdminWithdrawalsPage from "@/app/hosts/admin/withdrawals/page"
import AffiliatePayoutDetailsPage from "@/app/hosts/affiliate/payout-details/page"
import AffiliateWithdrawalsPage from "@/app/hosts/affiliate/withdrawals/page"
import MerchantPayoutDetailsPage from "@/app/hosts/merchant/payout-details/page"
import type { PayoutScreenData } from "@/lib/payouts/screen-types"

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
  withdrawals: [
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
  ],
}

const PARAMS = { searchParams: Promise.resolve({} as Record<string, string | string[] | undefined>) }

async function html(page: (props: typeof PARAMS) => Promise<React.ReactElement>, params = PARAMS): Promise<string> {
  return renderToStaticMarkup(await page(params))
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

beforeEach(() => {
  vi.clearAllMocks()

  payouts.getPayoutScreenAction.mockResolvedValue({ ok: true, data: SCREEN })
  payouts.listBanksAction.mockResolvedValue({ ok: true, data: [{ name: "Access Bank", code: "044" }] })
  payouts.listWithdrawalsAction.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null } })
  payouts.getPayoutSettingsAction.mockResolvedValue({
    ok: true,
    data: {
      values: { withdrawal_fee_bps: BigInt(100), min_withdrawal_kobo: BigInt(100_000) },
      changes: [],
    },
  })
  payouts.listBlackoutDatesAction.mockResolvedValue({ ok: true, data: [{ day: "2026-12-25", reason: "Christmas Day" }] })
  session.getAuthUser.mockResolvedValue({ id: "admin-1", email: "ada@example.com" })
})

describe("the affiliate payout details page", () => {
  it("shows the account, the automatic payout explanation and a link to withdrawals", async () => {
    const words = text(await html(AffiliatePayoutDetailsPage))

    expect(words).toContain("Payout details")
    expect(words).toContain("Access Bank, account ending 4821")
    expect(words).toContain("Automatic payout")
    expect(words).toContain("Go to withdrawals")
    // The affiliate app has its own Withdrawals page, so the form is not repeated here.
    expect(words).not.toContain("Amount in naira")
  })

  it("shows the error sentence instead of the panel when the screen cannot load", async () => {
    payouts.getPayoutScreenAction.mockResolvedValue({ ok: false, error: "Please sign in to continue." })

    const words = text(await html(AffiliatePayoutDetailsPage))

    expect(words).toContain("Please sign in to continue.")
    expect(words).not.toContain("Automatic payout")
  })

  it("still shows the account panel when only the bank list failed", async () => {
    payouts.listBanksAction.mockResolvedValue({ ok: false, error: "We could not reach the bank check right now." })

    const words = text(await html(AffiliatePayoutDetailsPage))

    expect(words).toContain("Access Bank, account ending 4821")
    expect(words).not.toContain("We could not reach the bank check right now.")
  })
})

describe("the affiliate withdrawals page", () => {
  it("shows the balances, the form and the history", async () => {
    const markup = await html(AffiliateWithdrawalsPage)
    const words = text(markup)

    expect(words).toContain("Withdrawals")
    expect(words).toContain("Available")
    expect(words).toContain("₦45,000")
    expect(markup).toContain('aria-label="Request a withdrawal"')
    expect(words).toContain("Recent withdrawals")
    expect(words).toContain("₦10,000")
  })

  it("shows the error sentence when the screen cannot load", async () => {
    payouts.getPayoutScreenAction.mockResolvedValue({ ok: false, error: "Please sign in to continue." })

    const words = text(await html(AffiliateWithdrawalsPage))

    expect(words).toContain("Please sign in to continue.")
    expect(words).not.toContain("Available")
  })
})

describe("the merchant payout details page", () => {
  it("carries the withdraw form and the history, because the merchant app has no Withdrawals section", async () => {
    const markup = await html(MerchantPayoutDetailsPage)
    const words = text(markup)

    expect(words).toContain("Payout details")
    expect(words).toContain("Automatic payout")
    expect(words).toContain("Withdrawals")
    expect(markup).toContain('aria-label="Request a withdrawal"')
    expect(words).toContain("Recent withdrawals")
    // No link to a page that does not exist in this app.
    expect(words).not.toContain("Go to withdrawals")
  })

  it("shows the error sentence when the screen cannot load", async () => {
    payouts.getPayoutScreenAction.mockResolvedValue({ ok: false, error: "Please sign in to continue." })

    const words = text(await html(MerchantPayoutDetailsPage))

    expect(words).toContain("Please sign in to continue.")
    expect(words).not.toContain("Amount in naira")
  })
})

describe("the admin withdrawals page", () => {
  it("opens on the needs approval tab", async () => {
    const words = text(await html(AdminWithdrawalsPage))

    expect(words).toContain("Withdrawals")
    expect(words).toContain("Needs approval")
    expect(words).toContain("Approved and processing")
    expect(words).toContain("Nothing here right now.")
    expect(payouts.listWithdrawalsAction).toHaveBeenCalledWith({ tab: "needs_approval" })
  })

  it("shows the queue error from the action", async () => {
    payouts.listWithdrawalsAction.mockResolvedValue({ ok: false, error: "You do not have permission to do that." })

    const words = text(await html(AdminWithdrawalsPage))

    expect(words).toContain("You do not have permission to do that.")
  })

  it("asks a signed out person to sign in, and does not render the queue", async () => {
    session.getAuthUser.mockResolvedValue(null)

    const words = text(await html(AdminWithdrawalsPage))

    expect(words).toContain("Sign in to continue.")
    expect(words).not.toContain("Needs approval")
  })
})

describe("the admin settings page", () => {
  it("shows the payout settings form by default", async () => {
    const words = text(await html(AdminSettingsPage))

    expect(words).toContain("Settings")
    expect(words).toContain("Payout settings")
    expect(words).toContain("Blackout dates")
    expect(words).toContain("Withdrawal fee")
    expect(words).toContain("Review changes")
    expect(payouts.getPayoutSettingsAction).toHaveBeenCalled()
    expect(payouts.listBlackoutDatesAction).not.toHaveBeenCalled()
  })

  it("shows the blackout dates on the blackout tab", async () => {
    const words = text(
      await html(AdminSettingsPage, {
        searchParams: Promise.resolve({ tab: "blackout" }),
      }),
    )

    expect(words).toContain("How blackout dates work")
    expect(words).toContain("25 Dec 2026")
    expect(words).toContain("Christmas Day")
    expect(payouts.listBlackoutDatesAction).toHaveBeenCalled()
    expect(payouts.getPayoutSettingsAction).not.toHaveBeenCalled()
  })

  it("falls back to the payout settings for a tab it does not know", async () => {
    const words = text(
      await html(AdminSettingsPage, {
        searchParams: Promise.resolve({ tab: "something-else" }),
      }),
    )

    expect(words).toContain("Withdrawal fee")
    expect(payouts.getPayoutSettingsAction).toHaveBeenCalled()
  })

  it("shows the settings error instead of an empty form", async () => {
    payouts.getPayoutSettingsAction.mockResolvedValue({ ok: false, error: "Settings could not be loaded." })

    const words = text(await html(AdminSettingsPage))

    expect(words).toContain("Settings could not be loaded.")
    expect(words).not.toContain("Review changes")
  })
})

// Keeps the import of createElement used even if a test stops rendering directly.
void createElement
