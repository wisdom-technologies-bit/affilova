import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, vi } from "vitest"

// The design review pages for the payout screens.
//
// Each screen is rendered through the real components with fixed mock props and
// written as a plain HTML file beside the compiled stylesheet. A browser then
// screenshots those files at 1440x900 and 390x844. No database, no session, no
// server action: what is being looked at is the layout, the words in each state,
// and whether anything overflows.
//
// Skipped in the ordinary suite (SCREENS=1 turns it on) because it writes files.
// The screenshots are committed under docs/design-review/payouts and the folder
// is deleted before merge.

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

import { AppShell } from "@/components/app-shell/app-shell"
import { PageHeader } from "@/components/app-shell/page-header"
import { AdminWithdrawalsQueue } from "@/components/payouts/admin-withdrawals"
import { BlackoutDatesPanel } from "@/components/payouts/blackout-dates-panel"
import { PayoutDetailsPanel } from "@/components/payouts/payout-details-panel"
import { PayoutSettingsPanel } from "@/components/payouts/payout-settings-panel"
import { WithdrawPanel } from "@/components/payouts/withdraw-panel"
import { WithdrawalHistory } from "@/components/payouts/withdrawal-history"
import type {
  AdminQueueRow,
  BankOption,
  PayoutScreenData,
  PayoutSettingsSnapshot,
  ScreenWithdrawal,
  WithdrawalPreviewView,
} from "@/lib/payouts/screen-types"

// The shell links to every app the account may open, so the public host map has
// to be present while these pages are rendered.
for (const [key, value] of Object.entries({
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://affilova.example.com",
  NEXT_PUBLIC_HOST_PUBLIC: "affilova.example.com",
  NEXT_PUBLIC_HOST_AFFILIATE: "affiliates.affilova.example.com",
  NEXT_PUBLIC_HOST_MERCHANT: "merchants.affilova.example.com",
  NEXT_PUBLIC_HOST_ACCOUNT: "account.affilova.example.com",
  NEXT_PUBLIC_HOST_ADMIN: "admin.affilova.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_COOKIE_DOMAIN: "",
})) {
  process.env[key] = value
}

const OUTPUT = join(process.cwd(), "docs/design-review/payouts")
const HTML_DIR = join(OUTPUT, "html")
const CSS_DIR = join(process.cwd(), ".next/static/chunks")
const BRAND_DIR = join(process.cwd(), "public/brand")

const USER = {
  userId: "user-1",
  displayName: "Ada Okonkwo",
  email: "ada@example.com",
  roles: [{ role: "affiliate" as const, status: "active" as const }],
}

const BANKS: readonly BankOption[] = [
  { name: "Access Bank", code: "044" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Kuda Microfinance Bank", code: "50211" },
  { name: "Sterling Bank", code: "232" },
  { name: "United Bank for Africa", code: "033" },
  { name: "Wema Bank", code: "035" },
  { name: "Zenith Bank", code: "057" },
]

const SCREEN: PayoutScreenData = {
  account: {
    bankName: "Guaranty Trust Bank",
    accountLast4: "4821",
    accountName: "Ada Okonkwo",
    frozenUntil: null,
  },
  autoPayout: true,
  availableKobo: BigInt(18_250_000),
  pendingKobo: BigInt(3_200_000),
  totalKobo: BigInt(21_450_000),
  today: "2026-11-24",
  nextPayoutDay: "2026-11-25",
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

const NO_ACCOUNT: PayoutScreenData = { ...SCREEN, account: null, autoPayout: false }

const FROZEN: PayoutScreenData = {
  ...SCREEN,
  account: {
    bankName: "Zenith Bank",
    accountLast4: "9012",
    accountName: "Ada Okonkwo",
    frozenUntil: "2026-11-27T09:15:00.000Z",
  },
}

const WITHDRAWALS: readonly ScreenWithdrawal[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "manual",
    status: "requested",
    grossKobo: BigInt(1_000_000),
    feeKobo: BigInt(10_000),
    netKobo: BigInt(990_000),
    requestedAt: "2026-11-23T09:12:00.000Z",
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
    requestedAt: "2026-11-20T08:00:00.000Z",
    paidAt: "2026-11-20T11:30:00.000Z",
    reason: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "manual",
    status: "rejected",
    grossKobo: BigInt(200_000),
    feeKobo: BigInt(5_000),
    netKobo: BigInt(195_000),
    requestedAt: "2026-11-18T14:40:00.000Z",
    paidAt: null,
    reason: "The account name did not match your profile.",
  },
]

const PREVIEW: WithdrawalPreviewView = {
  allowed: true,
  reasons: [],
  grossKobo: BigInt(5_000_000),
  feeKobo: BigInt(50_000),
  netKobo: BigInt(4_950_000),
  availableKobo: BigInt(18_250_000),
  nextPayoutDay: "2026-11-25",
  needsApproval: false,
}

function queueRow(overrides: Partial<AdminQueueRow>): AdminQueueRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "user-1",
    kind: "manual",
    status: "requested",
    grossKobo: BigInt(5_000_000),
    feeKobo: BigInt(50_000),
    netKobo: BigInt(4_950_000),
    requestedAt: "2026-11-24T09:12:00.000Z",
    paidAt: null,
    failureReason: null,
    bankName: "Guaranty Trust Bank",
    accountLast4: "4821",
    accountName: "Ada Okonkwo",
    isFirst: false,
    hasRiskFlag: false,
    approvals: 0,
    needsTwoApprovers: false,
    needsSecondApprover: false,
    firstApprover: null,
    ...overrides,
  }
}

const QUEUE_ROWS: readonly AdminQueueRow[] = [
  queueRow({
    id: "44444444-4444-4444-8444-444444444401",
    userId: "user-1",
    isFirst: true,
    grossKobo: BigInt(1_200_000),
    feeKobo: BigInt(12_000),
    netKobo: BigInt(1_188_000),
    bankName: "Access Bank",
    accountLast4: "7734",
    accountName: "Chidi Okeke",
    requestedAt: "2026-11-24T09:12:00.000Z",
  }),
  queueRow({
    id: "44444444-4444-4444-8444-444444444402",
    userId: "user-2",
    grossKobo: BigInt(12_500_000),
    feeKobo: BigInt(125_000),
    netKobo: BigInt(12_375_000),
    bankName: "Zenith Bank",
    accountLast4: "9012",
    accountName: "Ngozi Balogun",
    needsTwoApprovers: true,
    needsSecondApprover: true,
    approvals: 1,
    firstApprover: "admin-1",
    hasRiskFlag: true,
    requestedAt: "2026-11-24T07:45:00.000Z",
  }),
  queueRow({
    id: "44444444-4444-4444-8444-444444444403",
    userId: "admin-1",
    kind: "auto",
    grossKobo: BigInt(3_000_000),
    feeKobo: BigInt(30_000),
    netKobo: BigInt(2_970_000),
    bankName: "Kuda Microfinance Bank",
    accountLast4: "2210",
    accountName: "Tunde Adeyemi",
    requestedAt: "2026-11-23T18:02:00.000Z",
  }),
]

const SETTINGS: PayoutSettingsSnapshot = {
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
      changedAt: "2026-11-23T10:05:00.000Z",
    },
    {
      key: "commission_hold_days",
      oldValue: BigInt(14),
      newValue: BigInt(7),
      changedBy: "admin-1",
      changedAt: "2026-11-21T16:20:00.000Z",
    },
  ],
}

function page(app: "affiliate" | "merchant" | "admin", children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      app,
      roles: app === "admin" ? ["admin"] : app === "merchant" ? ["vendor"] : ["affiliate"],
      user: USER,
      children,
    }),
  )
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="./app.css">
</head>
<body class="bg-background text-brand-ink antialiased">${body}</body>
</html>`
}

function writeScreen(name: string, title: string, body: string): void {
  // The shell points at /brand/..., which is a server path. These files are
  // opened straight from disk, so the logo is rewritten to the copy beside them.
  const html = document(title, body).replaceAll('src="/brand/', 'src="./brand/')

  writeFileSync(join(HTML_DIR, `${name}.html`), html)
}

/** Every stylesheet the build emitted, in one file the review pages can link. */
function css(): string {
  let names: string[] = []

  try {
    names = readdirSync(CSS_DIR).filter((name) => name.endsWith(".css"))
  } catch {
    return ""
  }

  return names
    .map((name) => readFileSync(join(CSS_DIR, name), "utf8"))
    .join("\n")
}

function copyBrand(): void {
  const target = join(HTML_DIR, "brand")

  mkdirSync(target, { recursive: true })

  for (const name of readdirSync(BRAND_DIR)) {
    if (name.endsWith(".svg")) {
      copyFileSync(join(BRAND_DIR, name), join(target, name))
    }
  }
}

describe.skipIf(process.env.SCREENS !== "1")("the payout screens", () => {
  it("writes one html file per screen", () => {
    mkdirSync(HTML_DIR, { recursive: true })
    writeFileSync(join(HTML_DIR, "app.css"), css())
    copyBrand()

    writeScreen(
      "payout-details-no-account",
      "Payout details: no account",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Payout details" }),
          createElement(PayoutDetailsPanel, {
            data: NO_ACCOUNT,
            banks: BANKS,
            withdrawalsHref: "/withdrawals",
          }),
        ),
      ),
    )

    writeScreen(
      "payout-details-saved",
      "Payout details: saved account",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Payout details" }),
          createElement(PayoutDetailsPanel, {
            data: SCREEN,
            banks: BANKS,
            withdrawalsHref: "/withdrawals",
          }),
        ),
      ),
    )

    writeScreen(
      "payout-details-frozen",
      "Payout details: frozen after a change",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Payout details" }),
          createElement(PayoutDetailsPanel, {
            data: FROZEN,
            banks: BANKS,
            withdrawalsHref: "/withdrawals",
          }),
        ),
      ),
    )

    writeScreen(
      "withdrawals-preview",
      "Withdrawals: preview and history",
      page(
        "affiliate",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Withdrawals" }),
          createElement(WithdrawPanel, {
            data: { ...SCREEN, withdrawals: WITHDRAWALS },
            payoutDetailsHref: "/payout-details",
            initial: { amount: "50000", preview: PREVIEW },
          }),
          createElement(
            "div",
            { className: "mt-8" },
            createElement("h2", { className: "mb-3 text-lg font-semibold text-brand-ink" }, "Recent withdrawals"),
            createElement(WithdrawalHistory, { withdrawals: WITHDRAWALS }),
          ),
        ),
      ),
    )

    writeScreen(
      "admin-withdrawals",
      "Admin: withdrawal queue",
      page(
        "admin",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Withdrawals" }),
          createElement(AdminWithdrawalsQueue, {
            currentUserId: "admin-1",
            initialTab: "needs_approval",
            initialPage: { rows: QUEUE_ROWS, nextCursor: null },
          }),
        ),
      ),
    )

    writeScreen(
      "admin-settings",
      "Admin: payout settings",
      page(
        "admin",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Settings" }),
          createElement(PayoutSettingsPanel, { snapshot: SETTINGS }),
        ),
      ),
    )

    writeScreen(
      "admin-blackout",
      "Admin: blackout dates",
      page(
        "admin",
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Settings" }),
          createElement(BlackoutDatesPanel, {
            days: [
              { day: "2026-12-25", reason: "Christmas Day" },
              { day: "2026-12-26", reason: "Boxing Day" },
              { day: "2027-01-01", reason: "New Year's Day" },
            ],
          }),
        ),
      ),
    )
  })
})
