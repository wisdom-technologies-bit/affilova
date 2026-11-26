import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// The finance screens, rendered to plain HTML for the design review.
//
// No database and no session: the components get fixed props, so what is being
// looked at is the layout, the words in every state, and the states a person
// sees. SCREENS=1 turns it on, because it writes files; the screenshots are
// committed under docs/design-review/finance.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/finance",
  redirect: vi.fn(),
}))

vi.mock("@/lib/admin/finance-actions", () => ({
  decideDisputeAction: vi.fn(),
  listDisputesAction: vi.fn(),
  listLedgerAction: vi.fn(),
  listOrdersAction: vi.fn(),
  listRefundsAction: vi.fn(),
  retryRefundSubmissionAction: vi.fn(),
  setVatPeriodStatusAction: vi.fn(),
  addVatAdjustmentAction: vi.fn(),
}))

import { AppShell } from "@/components/app-shell/app-shell"
import { PageHeader } from "@/components/app-shell/page-header"
import { OverviewPanel } from "@/components/admin-finance/overview"
import { DisputesView, LedgerView, OrderDetailView, OrdersView, ReconciliationView, RefundsView } from "@/components/admin-finance/transactions"
import { VatDetailView, VatPeriodsView } from "@/components/admin-finance/vat"
import {
  parseOrderDetail,
  parseOverview,
  type DailyPoint,
  type DisputeQueueRow,
  type OrderRow,
  type RefundQueueRow,
  type TrialBalance,
  type VatPeriod,
  type VatPeriodDetail,
} from "@/lib/admin/screen-types"

const OUTPUT = join(process.cwd(), "docs/design-review/finance/html")
const CSS_DIR = join(process.cwd(), ".next/static/chunks")
const BRAND_DIR = join(process.cwd(), "public/brand")

const SUMMARY = {
  userId: "user-1",
  displayName: "Ada Okonkwo",
  email: "ada@example.com",
  roles: [{ role: "admin" as const, status: "active" as const }],
}

function page(children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppShell, { app: "admin", roles: ["admin"], user: SUMMARY, children }),
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
  const html = document(title, body).replaceAll('src="/brand/', 'src="./brand/')

  writeFileSync(join(OUTPUT, `${name}.html`), html)
}

function css(): string {
  let names: string[] = []

  try {
    names = readdirSync(CSS_DIR).filter((name) => name.endsWith(".css"))
  } catch {
    return ""
  }

  return names.map((name) => readFileSync(join(CSS_DIR, name), "utf8")).join("\n")
}

const OVERVIEW = parseOverview({
  gmv_kobo: 7_000_000,
  orders: 6,
  refunds_count: 1,
  refunds_kobo: 1_000_000,
  platform_revenue_kobo: 1_100_000,
  processor_fees_kobo: 170_000,
  net_margin_kobo: 930_000,
  vendor_payables_kobo: 9_462_500,
  affiliate_payables_kobo: 400_000,
  open_disputes: 1,
  disputes_needing_decision: 1,
  refunds_awaiting_decision: 1,
  failed_refund_submissions: 1,
  withdrawals_awaiting_approval: 1,
  products_awaiting_review: 1,
  files_needing_scan_review: 1,
  dead_jobs: 1,
})

const CLEAN = parseOverview({ orders: 0 })

const POINTS: DailyPoint[] = [
  { day: "2026-11-19", orders: 1, gmvKobo: BigInt(1_000_000), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(100_000) },
  { day: "2026-11-20", orders: 0, gmvKobo: BigInt(0), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(0) },
  { day: "2026-11-21", orders: 2, gmvKobo: BigInt(2_000_000), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(200_000) },
  { day: "2026-11-22", orders: 1, gmvKobo: BigInt(1_000_000), refundsKobo: BigInt(1_000_000), platformRevenueKobo: BigInt(0) },
  { day: "2026-11-23", orders: 1, gmvKobo: BigInt(1_000_000), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(100_000) },
  { day: "2026-11-24", orders: 1, gmvKobo: BigInt(2_000_000), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(700_000) },
]

const ORDERS: readonly OrderRow[] = [
  { id: "o1", number: "AFV-1001", status: "paid", totalKobo: BigInt(1_000_000), paidAt: "2026-11-23T11:00:00Z", createdAt: "2026-11-23T10:58:00Z", productTitle: "Finance Product One", vendorName: "Vendor One", maskedEmail: "b***@gmail.com", hasAffiliate: true },
  { id: "o2", number: "AFV-1002", status: "refunded", totalKobo: BigInt(2_000_000), paidAt: "2026-11-22T09:00:00Z", createdAt: "2026-11-22T08:55:00Z", productTitle: "Finance Product Two", vendorName: "Vendor Two", maskedEmail: "c***@yahoo.com", hasAffiliate: false },
  { id: "o3", number: "AFV-1003", status: "disputed", totalKobo: BigInt(1_000_000), paidAt: "2026-11-21T18:00:00Z", createdAt: "2026-11-21T17:58:00Z", productTitle: "Finance Product One", vendorName: "Vendor One", maskedEmail: "d***@outlook.com", hasAffiliate: true },
]

const REFUNDS: readonly RefundQueueRow[] = [
  { id: "r1", orderId: "o2", orderNumber: "AFV-1002", productTitle: "Finance Product Two", amountKobo: BigInt(2_000_000), status: "failed", autoApproved: false, requestedAt: "2026-11-24T09:00:00Z", decidedAt: "2026-11-24T09:10:00Z", hasProviderReference: false },
  { id: "r2", orderId: "o1", orderNumber: "AFV-1001", productTitle: "Finance Product One", amountKobo: BigInt(1_000_000), status: "requested", autoApproved: false, requestedAt: "2026-11-24T10:00:00Z", decidedAt: null, hasProviderReference: false },
  { id: "r3", orderId: "o3", orderNumber: "AFV-1003", productTitle: "Finance Product One", amountKobo: BigInt(500_000), status: "processed", autoApproved: true, requestedAt: "2026-11-20T09:00:00Z", decidedAt: "2026-11-20T09:00:05Z", hasProviderReference: true },
]

const DISPUTES: readonly DisputeQueueRow[] = [
  { id: "d1", orderId: "o3", orderNumber: "AFV-1003", productTitle: "Finance Product One", amountKobo: BigInt(1_000_000), outcome: "open", openedAt: "2026-11-22T09:00:00Z", resolvedAt: null, providerResolution: "declined", providerResolvedAt: "2026-11-25T09:00:00Z", needsDecision: true, maskedEmail: "d***@outlook.com" },
  { id: "d2", orderId: "o2", orderNumber: "AFV-1002", productTitle: "Finance Product Two", amountKobo: BigInt(2_000_000), outcome: "won", openedAt: "2026-11-18T09:00:00Z", resolvedAt: "2026-11-19T09:00:00Z", providerResolution: "accepted", providerResolvedAt: "2026-11-19T08:00:00Z", needsDecision: false, maskedEmail: "c***@yahoo.com" },
]

const BALANCE: TrialBalance = {
  asOf: null,
  accounts: [
    { code: "paystack_balance", name: "Paystack balance", kind: "asset", debitKobo: BigInt(11_830_000), creditKobo: BigInt(1_000_000), balanceKobo: BigInt(10_830_000) },
    { code: "vendor_payable", name: "Vendor payable", kind: "liability", debitKobo: BigInt(1_000_000), creditKobo: BigInt(10_462_500), balanceKobo: BigInt(9_462_500) },
    { code: "affiliate_payable", name: "Affiliate payable", kind: "liability", debitKobo: BigInt(0), creditKobo: BigInt(400_000), balanceKobo: BigInt(400_000) },
    { code: "platform_revenue", name: "Platform revenue", kind: "revenue", debitKobo: BigInt(0), creditKobo: BigInt(1_100_000), balanceKobo: BigInt(1_100_000) },
  ],
  totals: { debitKobo: BigInt(13_000_000), creditKobo: BigInt(13_000_000), differenceKobo: BigInt(0) },
  balanced: true,
  payables: { partySumKobo: BigInt(9_862_500), accountsKobo: BigInt(9_862_500), match: true },
}

function period(overrides: Partial<VatPeriod> = {}): VatPeriod {
  return {
    period: "2026-09-01",
    status: "open",
    outputVatKobo: BigInt(30_000),
    creditNotesKobo: BigInt(0),
    adjustmentsKobo: BigInt(1_000),
    netPayableKobo: BigInt(31_000),
    dueDate: "2026-10-21",
    daysUntilDue: -4,
    remittedAmountKobo: BigInt(0),
    remittedAt: null,
    paymentReference: null,
    ...overrides,
  }
}

const PERIODS: readonly VatPeriod[] = [
  period({ period: "2026-11-01", status: "open", dueDate: "2026-12-21", daysUntilDue: 26, netPayableKobo: BigInt(0), outputVatKobo: BigInt(0) }),
  period({ period: "2026-10-01", status: "open", dueDate: "2026-11-21", daysUntilDue: -4, netPayableKobo: BigInt(48_500), outputVatKobo: BigInt(48_500) }),
  period({ period: "2026-09-01", status: "filed", daysUntilDue: -34 }),
  period({ period: "2026-08-01", status: "remitted", daysUntilDue: -64, remittedAmountKobo: BigInt(22_000), paymentReference: "VAT-REF-08" }),
]

const DETAIL: VatPeriodDetail = {
  summary: period(),
  adjustments: [{ id: "a1", period: "2026-09-01", amountKobo: BigInt(1_000), reason: "Rounding correction on the September return", createdAt: null }],
  lines: {
    rows: [
      { id: "l1", orderNumber: "AFV-0901", paidDateLagos: "2026-09-14", basis: "platform_fee", rateBps: 750, baseKobo: BigInt(100_000), taxKobo: BigInt(7_500), supplier: "affilova", refunded: false },
      { id: "l2", orderNumber: "AFV-0902", paidDateLagos: "2026-09-18", basis: "platform_fee", rateBps: 750, baseKobo: BigInt(300_000), taxKobo: BigInt(22_500), supplier: "affilova", refunded: true },
    ],
    nextCursor: null,
  },
}

const ORDER_DETAIL = parseOrderDetail({
  order: { id: "o1", number: "AFV-1001", status: "paid", total_kobo: 1_000_000, subtotal_kobo: 1_000_000, tax_kobo: 0, currency: "NGN", processor_fee_kobo: 15_000, paid_at: "2026-11-23T11:00:00Z", created_at: "2026-11-23T10:58:00Z" },
  items: [{ title: "Finance Product One", unit_price_kobo: 1_000_000, platform_fee_kobo: 100_000, affiliate_commission_kobo: 200_000, vendor_net_kobo: 700_000, tax_deducted_kobo: 0 }],
  buyer: { email: "buyer@example.com", masked_email: "b***@example.com", full_email_visible: true, name: "Buyer One" },
  vendor: { business_name: "Vendor One" },
  affiliate: { username: "affiliate_one" },
  entitlements: { files: 1, downloads_used: 2, downloads_allowed: 5, revoked: 0 },
  refund_requests: [{ id: "r2", status: "requested", reason: "The file would not open.", requested_at: "2026-11-24T10:00:00Z", decided_at: null, decision_note: null, auto_approved: false }],
  disputes: [{ id: "d1", outcome: "open", opened_at: "2026-11-22T09:00:00Z", resolved_at: null, provider_resolution: "declined", provider_resolved_at: "2026-11-25T09:00:00Z", needs_decision: true, note: null }],
  webhook_events: [{ event_type: "charge.success", status: "processed", received_at: "2026-11-23T11:00:02Z", processed_at: "2026-11-23T11:00:03Z", error: null }],
  emails: [{ kind: "purchase_receipt", status: "sent", created_at: "2026-11-23T11:00:05Z" }],
  ledger: {
    transactions: [
      {
        id: "t1",
        kind: "sale",
        description: "AFV-1001",
        created_at: "2026-11-23T11:00:04Z",
        entries: [
          { account_code: "paystack_balance", party: null, debit_kobo: 1_000_000, credit_kobo: 0, available_at: "2026-11-25" },
          { account_code: "vendor_payable", party: "Vendor One", debit_kobo: 0, credit_kobo: 700_000, available_at: "2026-11-25" },
          { account_code: "affiliate_payable", party: "affiliate_one", debit_kobo: 0, credit_kobo: 200_000, available_at: "2026-11-25" },
          { account_code: "platform_revenue", party: null, debit_kobo: 0, credit_kobo: 100_000, available_at: null },
        ],
      },
    ],
  },
})

describe.skipIf(process.env.SCREENS !== "1")("the finance screens", () => {
  it("writes one html file per screen", () => {
    mkdirSync(OUTPUT, { recursive: true })
    mkdirSync(join(OUTPUT, "brand"), { recursive: true })
    writeFileSync(join(OUTPUT, "app.css"), css())

    for (const name of readdirSync(BRAND_DIR, { withFileTypes: true })) {
      if (name.isFile()) {
        copyFileSync(join(BRAND_DIR, name.name), join(OUTPUT, "brand", name.name))
      }
    }

    writeScreen(
      "finance-overview",
      "Finance overview",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Finance" }),
          createElement(OverviewPanel, { overview: OVERVIEW, points: POINTS, range: { from: "2026-11-19", to: "2026-11-24" } }),
        ),
      ),
    )

    writeScreen(
      "finance-overview-clear",
      "Finance overview, nothing waiting",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Finance" }),
          createElement(OverviewPanel, { overview: CLEAN, points: [], range: { from: "2026-11-24", to: "2026-11-24" } }),
        ),
      ),
    )

    writeScreen(
      "finance-orders",
      "Orders",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(OrdersView, {
            initialPage: { rows: ORDERS, nextCursor: null },
            initialQuery: { q: "", status: "", from: "", to: "" },
          }),
        ),
      ),
    )

    writeScreen(
      "finance-orders-empty",
      "Orders, nothing found",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(OrdersView, {
            initialPage: { rows: [], nextCursor: null },
            initialQuery: { q: "nobody@example.com", status: "", from: "", to: "" },
          }),
        ),
      ),
    )

    writeScreen(
      "finance-refunds",
      "Refunds",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(RefundsView, { initialPage: { rows: REFUNDS, nextCursor: null }, canManage: true }),
        ),
      ),
    )

    writeScreen(
      "finance-disputes",
      "Disputes",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(DisputesView, { initialPage: { rows: DISPUTES, nextCursor: null }, canDecide: true }),
        ),
      ),
    )

    writeScreen(
      "finance-ledger",
      "Ledger",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(LedgerView, {
            initialPage: { rows: [], nextCursor: null, accounts: [{ id: 1, code: "vendor_payable", name: "Vendor payable", kind: "liability" }] },
            balanced: { balanced: true, differenceKobo: BigInt(0) },
          }),
        ),
      ),
    )

    writeScreen(
      "finance-reconciliation",
      "Reconciliation",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "Transactions" }),
          createElement(ReconciliationView, {
            balance: BALANCE,
            runs: [
              { id: "1", runAt: "2026-11-25T01:00:00Z", ledgerBalanceKobo: BigInt(10_830_000), providerBalanceKobo: BigInt(10_780_000), diffKobo: BigInt(50_000) },
              { id: "2", runAt: "2026-11-24T01:00:00Z", ledgerBalanceKobo: BigInt(9_830_000), providerBalanceKobo: BigInt(9_830_000), diffKobo: BigInt(0) },
            ],
          }),
        ),
      ),
    )

    writeScreen(
      "finance-vat",
      "VAT",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "VAT" }),
          createElement(VatPeriodsView, {
            periods: PERIODS,
            year: 2026,
            vatEnabled: true,
            rateBps: 750,
            basis: "platform_fee",
            today: "2026-11-25",
          }),
        ),
      ),
    )

    writeScreen(
      "finance-vat-month",
      "VAT month",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "VAT month" }),
          createElement(VatDetailView, { detail: DETAIL, period: "2026-09-01", today: "2026-10-25", vatEnabled: true }),
        ),
      ),
    )

    writeScreen(
      "finance-order-detail",
      "Order",
      page(
        createElement(
          "div",
          null,
          createElement(PageHeader, { title: "AFV-1001" }),
          createElement(OrderDetailView, { detail: ORDER_DETAIL!, canManageRefunds: true, canDecideDisputes: true }),
        ),
      ),
    )

    expect(readdirSync(OUTPUT).filter((name) => name.endsWith(".html")).length).toBe(11)
  })
})
