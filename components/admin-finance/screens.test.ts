import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// What the finance screens put on the page, in every state they can be in.
//
// Render tests, not browser tests: each screen is rendered to static markup with
// real props and the test reads what a person would read.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
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

import { AttentionPanel, DailyChart, DailyTable, OverviewPanel } from "./overview"
import { DisputesView, LedgerView, OrdersView, ReconciliationView, RefundsView } from "./transactions"
import { VatDetailView, VatPeriodsView, vatStatusText } from "./vat"
import {
  attentionItems,
  parseOrderDetail,
  parseOverview,
  type DailyPoint,
  type DisputeQueueRow,
  type Overview,
  type RefundQueueRow,
  type TrialBalance,
  type VatPeriod,
  type VatPeriodDetail,
} from "@/lib/admin/screen-types"

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

const OVERVIEW: Overview = parseOverview({
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
  disputes_needing_decision: 0,
  refunds_awaiting_decision: 1,
  failed_refund_submissions: 1,
  withdrawals_awaiting_approval: 1,
  products_awaiting_review: 1,
  files_needing_scan_review: 1,
  dead_jobs: 1,
})

const CLEAN: Overview = parseOverview({ orders: 0 })

const POINTS: DailyPoint[] = [
  { day: "2026-11-23", orders: 1, gmvKobo: BigInt(1_000_000), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(100_000) },
  { day: "2026-11-24", orders: 0, gmvKobo: BigInt(0), refundsKobo: BigInt(0), platformRevenueKobo: BigInt(0) },
]

describe("the overview", () => {
  it("shows every key figure with its naira value", () => {
    const markup = html(
      createElement(OverviewPanel, { overview: OVERVIEW, points: POINTS, range: { from: "2026-11-23", to: "2026-11-24" } }),
    )

    expect(markup).toContain("Gross sales")
    expect(markup).toContain("Net margin")
    expect(markup).toContain("Vendor payables")
    expect(markup).toContain("70,000")
  })

  it("lists each non-zero counter with a link to where it is cleared", () => {
    const markup = html(createElement(AttentionPanel, { items: attentionItems(OVERVIEW) }))

    expect(markup).toContain("1 withdrawal is waiting for approval.")
    expect(markup).toContain("1 refund request is waiting for a decision.")
    expect(markup).toContain("1 file needs a scan review.")
    expect(markup).toContain('href="/withdrawals"')
    expect(markup).toContain('href="/transactions?tab=refunds"')
    expect(markup).not.toContain("dispute needs your decision")
  })

  it("says nothing needs attention when every counter is zero", () => {
    const markup = html(createElement(AttentionPanel, { items: attentionItems(CLEAN) }))

    expect(markup).toContain("Nothing needs attention")
    expect(attentionItems(CLEAN)).toHaveLength(0)
  })

  it("draws a bar per day and repeats every number in a table", () => {
    const chart = html(createElement(DailyChart, { points: POINTS }))
    const table = html(createElement(DailyTable, { points: POINTS }))

    expect(chart).toContain("Total")
    expect(table).toContain("23 Nov 2026")
    expect(table).toContain("Platform revenue")
  })

  it("says so honestly when the range has no days", () => {
    expect(html(createElement(DailyChart, { points: [] }))).toContain("No days in this range")
  })
})

const ORDER_PAGE = { rows: [], nextCursor: null } as const

describe("orders", () => {
  it("renders an honest empty state", () => {
    const markup = html(
      createElement(OrdersView, { initialPage: ORDER_PAGE, initialQuery: { q: "", status: "", from: "", to: "" } }),
    )

    expect(markup).toContain("No order matches this search")
  })

  it("renders an error and keeps the search form usable", () => {
    const markup = html(
      createElement(OrdersView, {
        initialPage: ORDER_PAGE,
        initialError: "That page has expired. Start again from the first page.",
        initialQuery: { q: "", status: "", from: "", to: "" },
      }),
    )

    expect(markup).toContain("That page has expired")
    expect(markup).toContain("Order number, reference or exact email")
  })

  it("shows a loaded order with its masked address and no full address", () => {
    const markup = html(
      createElement(OrdersView, {
        initialPage: {
          rows: [
            {
              id: "o1",
              number: "AFV-1001",
              status: "paid",
              totalKobo: BigInt(1_000_000),
              paidAt: "2026-11-23T11:00:00Z",
              createdAt: "2026-11-23T10:00:00Z",
              productTitle: "Finance Product One",
              vendorName: "Vendor One",
              maskedEmail: "b***@example.com",
              hasAffiliate: true,
            },
          ],
          nextCursor: null,
        },
        initialQuery: { q: "", status: "", from: "", to: "" },
      }),
    )

    expect(markup).toContain("AFV-1001")
    expect(markup).toContain("b***@example.com")
    expect(markup).not.toContain("buyer@example.com")
  })
})

const REFUND: RefundQueueRow = {
  id: "r1",
  orderId: "o1",
  orderNumber: "AFV-1001",
  productTitle: "Finance Product One",
  amountKobo: BigInt(1_000_000),
  status: "failed",
  autoApproved: false,
  requestedAt: "2026-11-24T09:00:00Z",
  decidedAt: null,
  hasProviderReference: false,
}

describe("refunds", () => {
  it("offers Retry on a failed submission", () => {
    const markup = html(
      createElement(RefundsView, { initialPage: { rows: [REFUND], nextCursor: null }, canManage: true }),
    )

    expect(markup).toContain("Retry")
    expect(markup).toContain("failed")
  })

  it("says finance or admin instead of a button for a role that cannot act", () => {
    const markup = html(
      createElement(RefundsView, { initialPage: { rows: [REFUND], nextCursor: null }, canManage: false }),
    )

    expect(markup).toContain("Finance or admin")
    expect(markup).not.toContain(">Retry<")
  })

  it("renders an honest empty queue", () => {
    const markup = html(createElement(RefundsView, { initialPage: ORDER_PAGE, canManage: true }))

    expect(markup).toContain("No refund request has this status.")
  })
})

const DISPUTE: DisputeQueueRow = {
  id: "d1",
  orderId: "o4",
  orderNumber: "AFV-1004",
  productTitle: "Finance Product One",
  amountKobo: BigInt(1_000_000),
  outcome: "open",
  openedAt: "2026-11-24T09:00:00Z",
  resolvedAt: null,
  providerResolution: "declined",
  providerResolvedAt: "2026-11-25T09:00:00Z",
  needsDecision: true,
  maskedEmail: "b***@example.com",
}

describe("disputes", () => {
  it("shows what Paystack said and that a decision is needed", () => {
    const markup = html(
      createElement(DisputesView, { initialPage: { rows: [DISPUTE], nextCursor: null }, canDecide: true }),
    )

    expect(markup).toContain("declined")
    expect(markup).toContain("Needs your decision")
    expect(markup).toContain("Won")
    expect(markup).toContain("Lost")
  })

  it("hides the decision buttons from a role that may not decide", () => {
    const markup = html(
      createElement(DisputesView, { initialPage: { rows: [DISPUTE], nextCursor: null }, canDecide: false }),
    )

    expect(markup).toContain("Nothing to do")
    expect(markup).not.toContain("Confirm won")
  })

  it("renders an honest empty state", () => {
    expect(
      html(createElement(DisputesView, { initialPage: ORDER_PAGE, canDecide: true })),
    ).toContain("No dispute has been opened.")
  })
})

const BALANCE: TrialBalance = {
  asOf: null,
  accounts: [
    { code: "paystack_balance", name: "Paystack balance", kind: "asset", debitKobo: BigInt(11_830_000), creditKobo: BigInt(1_000_000), balanceKobo: BigInt(10_830_000) },
  ],
  totals: { debitKobo: BigInt(13_000_000), creditKobo: BigInt(13_000_000), differenceKobo: BigInt(0) },
  balanced: true,
  payables: { partySumKobo: BigInt(9_862_500), accountsKobo: BigInt(9_862_500), match: true },
}

describe("ledger and reconciliation", () => {
  it("says the book is balanced in words", () => {
    const markup = html(
      createElement(LedgerView, {
        initialPage: { rows: [], nextCursor: null, accounts: [] },
        balanced: { balanced: true, differenceKobo: BigInt(0) },
      }),
    )

    expect(markup).toContain("Balanced: every debit has a credit.")
    expect(markup).toContain("No posting in this range")
  })

  it("names the amount when the book does not balance", () => {
    const markup = html(
      createElement(LedgerView, {
        initialPage: { rows: [], nextCursor: null, accounts: [] },
        balanced: { balanced: false, differenceKobo: BigInt(50_000) },
      }),
    )

    expect(markup).toContain("Not balanced")
    expect(markup).toContain("500")
  })

  it("shows both checks and the runs, and says what a difference means", () => {
    const markup = html(
      createElement(ReconciliationView, {
        balance: BALANCE,
        runs: [
          { id: "1", runAt: "2026-11-25T01:00:00Z", ledgerBalanceKobo: BigInt(10_830_000), providerBalanceKobo: BigInt(10_780_000), diffKobo: BigInt(50_000) },
        ],
      }),
    )

    expect(markup).toContain("Debits equal credits")
    expect(markup).toContain("Party balances match the payable accounts")
    expect(markup).toContain("Settlement in flight")
  })

  it("renders an honest empty state for the runs", () => {
    expect(html(createElement(ReconciliationView, { balance: BALANCE, runs: [] }))).toContain(
      "No run recorded yet",
    )
  })
})

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

describe("VAT status text", () => {
  it("is a sentence for every state, not a colour", () => {
    expect(vatStatusText(period(), "2026-10-25").text).toBe("Overdue by 4 days")
    expect(vatStatusText(period({ daysUntilDue: 0 }), "2026-10-21").text).toBe("Due today")
    expect(vatStatusText(period({ daysUntilDue: 6 }), "2026-10-15").text).toBe("Due in 6 days")
    expect(vatStatusText(period({ daysUntilDue: 40, netPayableKobo: BigInt(0) }), "2026-09-01").text).toBe("Not due yet")
    expect(vatStatusText(period({ status: "filed" }), "2026-10-15").text).toBe("Filed")
    expect(vatStatusText(period({ status: "remitted" }), "2026-10-15").text).toBe("Remitted")
  })

  it("uses the singular for one day", () => {
    expect(vatStatusText(period({ daysUntilDue: -1 }), "2026-10-22").text).toBe("Overdue by 1 day")
  })
})

describe("the VAT screens", () => {
  it("shows twelve months with a status sentence each", () => {
    const markup = html(
      createElement(VatPeriodsView, {
        periods: [period()],
        year: 2026,
        vatEnabled: true,
        rateBps: 750,
        basis: "platform_fee",
        today: "2026-10-25",
      }),
    )

    expect(markup).toContain("Overdue by 4 days")
    expect(markup).toContain("Open")
  })

  it("says VAT is switched off, with the current rate and basis", () => {
    const markup = html(
      createElement(VatPeriodsView, {
        periods: [period()],
        year: 2026,
        vatEnabled: false,
        rateBps: 750,
        basis: "platform_fee",
        today: "2026-10-25",
      }),
    )

    expect(markup).toContain("VAT is switched off")
    expect(markup).toContain("7.5% on the platform fee")
  })

  const DETAIL: VatPeriodDetail = {
    summary: period(),
    adjustments: [{ id: "a1", period: "2026-09-01", amountKobo: BigInt(1_000), reason: "Rounding correction", createdAt: null }],
    lines: {
      rows: [
        {
          id: "l1",
          orderNumber: "AFV-0901",
          paidDateLagos: "2026-09-14",
          basis: "platform_fee",
          rateBps: 750,
          baseKobo: BigInt(100_000),
          taxKobo: BigInt(7_500),
          supplier: "affilova",
          refunded: false,
        },
      ],
      nextCursor: null,
    },
  }

  it("shows the summary, the adjustments, the tax lines and the export link", () => {
    const markup = html(createElement(VatDetailView, { detail: DETAIL, period: "2026-09-01", today: "2026-10-25", vatEnabled: true }))

    expect(markup).toContain("Rounding correction")
    expect(markup).toContain("AFV-0901")
    expect(markup).toContain("/exports/vat?period=2026-09-01")
    expect(markup).toContain("Mark as filed")
    expect(markup).toContain("Mark as remitted")
    expect(markup).toContain("Add adjustment")
  })

  it("closes a remitted month, explaining that only an adjustment can change it", () => {
    const markup = html(
      createElement(VatDetailView, {
        detail: { ...DETAIL, summary: period({ status: "remitted", remittedAmountKobo: BigInt(31_000), paymentReference: "VAT-REF-1" }) },
        period: "2026-09-01",
        today: "2026-10-25",
        vatEnabled: true,
      }),
    )

    expect(markup).toContain("Remitted")
    expect(markup).toContain("A correction goes in as an adjustment")
    expect(markup).not.toContain("Mark as remitted")
  })

  it("renders an honest empty state for a month with no VAT", () => {
    const markup = html(
      createElement(VatDetailView, {
        detail: { ...DETAIL, adjustments: [], lines: { rows: [], nextCursor: null } },
        period: "2026-09-01",
        today: "2026-10-25",
        vatEnabled: true,
      }),
    )

    expect(markup).toContain("No VAT was charged in this month")
    expect(markup).toContain("No adjustment for this month")
  })
})

describe("the order detail", () => {
  const detail = parseOrderDetail({
    order: { id: "o1", number: "AFV-1001", status: "paid", total_kobo: 1_000_000, subtotal_kobo: 1_000_000, tax_kobo: 0, currency: "NGN" },
    items: [{ title: "Finance Product One", unit_price_kobo: 1_000_000, platform_fee_kobo: 100_000, affiliate_commission_kobo: 200_000, vendor_net_kobo: 700_000, tax_deducted_kobo: 0 }],
    buyer: { email: "buyer@example.com", masked_email: "b***@example.com", full_email_visible: true, name: "Buyer" },
    vendor: { business_name: "Vendor One" },
    affiliate: { username: "affiliate_one" },
    entitlements: { files: 1, downloads_used: 0, downloads_allowed: 5, revoked: 0 },
    refund_requests: [],
    disputes: [],
    webhook_events: [],
    emails: [],
    ledger: null,
  })

  it("shows the full address to admin and says the read is recorded", async () => {
    const { OrderDetailView } = await import("./transactions")
    const markup = html(
      createElement(OrderDetailView, { detail: detail!, canManageRefunds: true, canDecideDisputes: true }),
    )

    expect(markup).toContain("buyer@example.com")
    expect(markup).toContain("recorded against your account")
    expect(markup).toContain("The ledger is visible to admin and finance only.")
  })

  it("shows the masked address to finance", async () => {
    const { OrderDetailView } = await import("./transactions")
    const masked = { ...detail!, buyer: { ...detail!.buyer, email: null, fullEmailVisible: false } }
    const markup = html(createElement(OrderDetailView, { detail: masked, canManageRefunds: true, canDecideDisputes: true }))

    expect(markup).toContain("b***@example.com (masked for finance)")
    expect(markup).not.toContain("buyer@example.com")
  })
})
