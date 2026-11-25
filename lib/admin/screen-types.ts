// The shapes the admin finance screens render, and the parsers that read them.
//
// Every read function answers jsonb, which arrives as unknown. Nothing here casts
// and nothing is trusted: a field that is not the shape it should be becomes a
// default, and a row with no id is dropped, so a changed database function cannot
// crash a page. Money is bigint kobo all the way to the component, where
// formatNaira decides how it is written.

import { asArray, asRecord, toBoolean, toInteger, toText, toTextOrNull } from "@/lib/read-model/json"

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export type Page<T> = {
  rows: readonly T[]
  nextCursor: string | null
}

/** A page of rows plus whatever else the function returned beside them. */
export type LedgerPage = Page<LedgerTransaction> & { accounts: readonly LedgerAccount[] }

export type Overview = {
  gmvKobo: bigint
  orders: number
  refundsCount: number
  refundsKobo: bigint
  platformRevenueKobo: bigint
  processorFeesKobo: bigint
  netMarginKobo: bigint
  vendorPayablesKobo: bigint
  affiliatePayablesKobo: bigint
  openDisputes: number
  disputesNeedingDecision: number
  refundsAwaitingDecision: number
  failedRefundSubmissions: number
  withdrawalsAwaitingApproval: number
  productsAwaitingReview: number
  filesNeedingScanReview: number
  deadJobs: number
}

export type DailyPoint = {
  day: string
  orders: number
  gmvKobo: bigint
  refundsKobo: bigint
  platformRevenueKobo: bigint
}

export type OrderRow = {
  id: string
  number: string
  status: string
  totalKobo: bigint
  paidAt: string | null
  createdAt: string | null
  productTitle: string | null
  vendorName: string | null
  maskedEmail: string
  hasAffiliate: boolean
}

export type OrderItemRow = {
  title: string
  unitPriceKobo: bigint
  platformFeeKobo: bigint
  affiliateCommissionKobo: bigint
  vendorNetKobo: bigint
  taxDeductedKobo: bigint
}

export type TaxLineRow = {
  basis: string
  rateBps: number
  baseKobo: bigint
  taxKobo: bigint
  supplier: string
  included: boolean
}

export type RefundRow = {
  id: string
  status: string
  reason: string
  autoApproved: boolean
  requestedAt: string | null
  decidedAt: string | null
  hasProviderReference: boolean
  decisionNote: string | null
}

export type DisputeRow = {
  id: string
  outcome: string
  openedAt: string | null
  resolvedAt: string | null
  note: string | null
  providerResolution: string | null
  providerResolvedAt: string | null
  needsDecision: boolean
}

export type WebhookRow = {
  eventType: string | null
  status: string
  receivedAt: string | null
  processedAt: string | null
  error: string | null
}

export type EmailRow = {
  kind: string
  status: string
  createdAt: string | null
}

export type LedgerEntryRow = {
  accountCode: string
  party: string | null
  debitKobo: bigint
  creditKobo: bigint
  availableAt: string | null
}

export type LedgerTransaction = {
  id: string
  kind: string
  description: string | null
  createdAt: string | null
  entries: readonly LedgerEntryRow[]
}

export type OrderDetail = {
  id: string
  number: string
  status: string
  currency: string
  subtotalKobo: bigint
  taxKobo: bigint
  taxIncluded: boolean
  totalKobo: bigint
  processorFeeKobo: bigint
  paidAt: string | null
  createdAt: string | null
  items: readonly OrderItemRow[]
  taxLines: readonly TaxLineRow[]
  buyer: { email: string | null; maskedEmail: string; fullEmailVisible: boolean; name: string | null }
  vendor: { businessName: string | null }
  affiliate: { username: string | null } | null
  entitlements: { files: number; downloadsUsed: number; downloadsAllowed: number; revoked: number }
  refundRequests: readonly RefundRow[]
  disputes: readonly DisputeRow[]
  webhooks: readonly WebhookRow[]
  emails: readonly EmailRow[]
  ledger: { transactions: readonly LedgerTransaction[] } | null
}

export type RefundQueueRow = {
  id: string
  orderId: string
  orderNumber: string
  productTitle: string | null
  amountKobo: bigint
  status: string
  autoApproved: boolean
  requestedAt: string | null
  decidedAt: string | null
  hasProviderReference: boolean
}

export type DisputeQueueRow = {
  id: string
  orderId: string
  orderNumber: string
  productTitle: string | null
  amountKobo: bigint
  outcome: string
  openedAt: string | null
  resolvedAt: string | null
  providerResolution: string | null
  providerResolvedAt: string | null
  needsDecision: boolean
  maskedEmail: string
}

export type LedgerAccount = {
  id: number
  code: string
  name: string
  kind: string
}

export type TrialBalanceAccount = {
  code: string
  name: string
  kind: string
  debitKobo: bigint
  creditKobo: bigint
  balanceKobo: bigint
}

export type TrialBalance = {
  asOf: string | null
  accounts: readonly TrialBalanceAccount[]
  totals: { debitKobo: bigint; creditKobo: bigint; differenceKobo: bigint }
  balanced: boolean
  payables: { partySumKobo: bigint; accountsKobo: bigint; match: boolean }
}

export type ReconciliationRun = {
  id: string
  runAt: string | null
  ledgerBalanceKobo: bigint
  providerBalanceKobo: bigint
  diffKobo: bigint
}

export type VatPeriod = {
  period: string
  status: string
  outputVatKobo: bigint
  creditNotesKobo: bigint
  adjustmentsKobo: bigint
  netPayableKobo: bigint
  dueDate: string | null
  daysUntilDue: number
  remittedAmountKobo: bigint
  remittedAt: string | null
  paymentReference: string | null
}

export type VatAdjustment = {
  id: string
  period: string
  amountKobo: bigint
  reason: string
  createdAt: string | null
}

export type VatTaxLine = {
  id: string
  orderNumber: string
  paidDateLagos: string | null
  basis: string
  rateBps: number
  baseKobo: bigint
  taxKobo: bigint
  supplier: string
  refunded: boolean
}

export type VatPeriodDetail = {
  summary: VatPeriod
  adjustments: readonly VatAdjustment[]
  lines: Page<VatTaxLine>
}

export type VatExportRow = {
  orderNumber: string
  paidDateLagos: string
  basis: string
  rateBps: number
  baseKobo: bigint
  taxKobo: bigint
  supplier: string
  refunded: boolean
}

export type VatReminderTarget = {
  period: string
  reminder: "due_soon" | "overdue"
  dueDate: string
  netPayableKobo: bigint
  status: string
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** A bigint from a number, a numeric string, or nothing. */
export function toBigInt(value: unknown, fallback: bigint = BigInt(0)): bigint {
  if (typeof value === "bigint") {
    return value
  }

  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value)
  }

  return fallback
}

function record(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

function pageOf<T>(value: unknown, parseRow: (row: Record<string, unknown>) => T | null): Page<T> {
  const source = record(value)
  const rows: T[] = []

  for (const raw of asArray(source.items)) {
    const row = asRecord(raw)

    if (row === null) {
      continue
    }

    const parsed = parseRow(row)

    if (parsed !== null) {
      rows.push(parsed)
    }
  }

  return { rows, nextCursor: toTextOrNull(source.next_cursor) }
}

export function parseOverview(value: unknown): Overview {
  const v = record(value)

  return {
    gmvKobo: toBigInt(v.gmv_kobo),
    orders: toInteger(v.orders),
    refundsCount: toInteger(v.refunds_count),
    refundsKobo: toBigInt(v.refunds_kobo),
    platformRevenueKobo: toBigInt(v.platform_revenue_kobo),
    processorFeesKobo: toBigInt(v.processor_fees_kobo),
    netMarginKobo: toBigInt(v.net_margin_kobo),
    vendorPayablesKobo: toBigInt(v.vendor_payables_kobo),
    affiliatePayablesKobo: toBigInt(v.affiliate_payables_kobo),
    openDisputes: toInteger(v.open_disputes),
    disputesNeedingDecision: toInteger(v.disputes_needing_decision),
    refundsAwaitingDecision: toInteger(v.refunds_awaiting_decision),
    failedRefundSubmissions: toInteger(v.failed_refund_submissions),
    withdrawalsAwaitingApproval: toInteger(v.withdrawals_awaiting_approval),
    productsAwaitingReview: toInteger(v.products_awaiting_review),
    filesNeedingScanReview: toInteger(v.files_needing_scan_review),
    deadJobs: toInteger(v.dead_jobs),
  }
}

export function parseDailySeries(value: unknown): DailyPoint[] {
  const points: DailyPoint[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) {
      continue
    }

    const day = toText(v.day)

    if (day === "") {
      continue
    }

    points.push({
      day,
      orders: toInteger(v.orders),
      gmvKobo: toBigInt(v.gmv_kobo),
      refundsKobo: toBigInt(v.refunds_kobo),
      platformRevenueKobo: toBigInt(v.platform_revenue_kobo),
    })
  }

  return points
}

export function parseOrderRow(v: Record<string, unknown>): OrderRow | null {
  const id = toText(v.id)

  if (id === "") {
    return null
  }

  return {
    id,
    number: toText(v.number),
    status: toText(v.status),
    totalKobo: toBigInt(v.total_kobo),
    paidAt: toTextOrNull(v.paid_at),
    createdAt: toTextOrNull(v.created_at),
    productTitle: toTextOrNull(v.product_title),
    vendorName: toTextOrNull(v.vendor_name),
    maskedEmail: toText(v.masked_email),
    hasAffiliate: toBoolean(v.has_affiliate),
  }
}

export function parseOrderPage(value: unknown): Page<OrderRow> {
  return pageOf(value, parseOrderRow)
}

function parseLedgerEntries(value: unknown): LedgerEntryRow[] {
  const entries: LedgerEntryRow[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) {
      continue
    }

    entries.push({
      accountCode: toText(v.account_code),
      party: toTextOrNull(v.party),
      debitKobo: toBigInt(v.debit_kobo),
      creditKobo: toBigInt(v.credit_kobo),
      availableAt: toTextOrNull(v.available_at),
    })
  }

  return entries
}

export function parseLedgerTransaction(v: Record<string, unknown>): LedgerTransaction | null {
  const id = toText(v.id)

  if (id === "") {
    return null
  }

  return {
    id,
    kind: toText(v.kind),
    description: toTextOrNull(v.description),
    createdAt: toTextOrNull(v.created_at),
    entries: parseLedgerEntries(v.entries),
  }
}

export function parseOrderDetail(value: unknown): OrderDetail | null {
  const v = record(value)
  const order = record(v.order)
  const id = toText(order.id)

  if (id === "") {
    return null
  }

  const items: OrderItemRow[] = []
  for (const raw of asArray(v.items)) {
    const row = asRecord(raw)
    if (row === null) continue
    items.push({
      title: toText(row.title),
      unitPriceKobo: toBigInt(row.unit_price_kobo),
      platformFeeKobo: toBigInt(row.platform_fee_kobo),
      affiliateCommissionKobo: toBigInt(row.affiliate_commission_kobo),
      vendorNetKobo: toBigInt(row.vendor_net_kobo),
      taxDeductedKobo: toBigInt(row.tax_deducted_kobo),
    })
  }

  const taxLines: TaxLineRow[] = []
  for (const raw of asArray(v.tax_lines)) {
    const row = asRecord(raw)
    if (row === null) continue
    taxLines.push({
      basis: toText(row.basis),
      rateBps: toInteger(row.rate_bps),
      baseKobo: toBigInt(row.base_kobo),
      taxKobo: toBigInt(row.tax_kobo),
      supplier: toText(row.supplier),
      included: toBoolean(row.included),
    })
  }

  const buyer = record(v.buyer)
  const vendor = record(v.vendor)
  const affiliate = asRecord(v.affiliate)
  const entitlements = record(v.entitlements)
  const ledger = asRecord(v.ledger)

  const ledgerTransactions: LedgerTransaction[] = []
  if (ledger !== null) {
    for (const raw of asArray(ledger.transactions)) {
      const row = asRecord(raw)
      if (row === null) continue
      const parsed = parseLedgerTransaction(row)
      if (parsed !== null) ledgerTransactions.push(parsed)
    }
  }

  return {
    id,
    number: toText(order.number),
    status: toText(order.status),
    currency: toText(order.currency) || "NGN",
    subtotalKobo: toBigInt(order.subtotal_kobo),
    taxKobo: toBigInt(order.tax_kobo),
    taxIncluded: toBoolean(order.tax_included),
    totalKobo: toBigInt(order.total_kobo),
    processorFeeKobo: toBigInt(order.processor_fee_kobo),
    paidAt: toTextOrNull(order.paid_at),
    createdAt: toTextOrNull(order.created_at),
    items,
    taxLines,
    buyer: {
      email: toTextOrNull(buyer.email),
      maskedEmail: toText(buyer.masked_email),
      fullEmailVisible: toBoolean(buyer.full_email_visible),
      name: toTextOrNull(buyer.name),
    },
    vendor: { businessName: toTextOrNull(vendor.business_name) },
    affiliate: affiliate === null ? null : { username: toTextOrNull(affiliate.username) },
    entitlements: {
      files: toInteger(entitlements.files),
      downloadsUsed: toInteger(entitlements.downloads_used),
      downloadsAllowed: toInteger(entitlements.downloads_allowed),
      revoked: toInteger(entitlements.revoked),
    },
    refundRequests: parseRefundRows(v.refund_requests),
    disputes: parseDisputeRows(v.disputes),
    webhooks: parseWebhookRows(v.webhook_events),
    emails: parseEmailRows(v.emails),
    ledger: ledger === null ? null : { transactions: ledgerTransactions },
  }
}

function parseRefundRows(value: unknown): RefundRow[] {
  const rows: RefundRow[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) continue

    const id = toText(v.id)

    if (id === "") continue

    rows.push({
      id,
      status: toText(v.status),
      reason: toText(v.reason),
      autoApproved: toBoolean(v.auto_approved),
      requestedAt: toTextOrNull(v.requested_at),
      decidedAt: toTextOrNull(v.decided_at),
      hasProviderReference: toBoolean(v.has_provider_reference),
      decisionNote: toTextOrNull(v.decision_note),
    })
  }

  return rows
}

function parseDisputeRows(value: unknown): DisputeRow[] {
  const rows: DisputeRow[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) continue

    const id = toText(v.id)

    if (id === "") continue

    rows.push({
      id,
      outcome: toText(v.outcome),
      openedAt: toTextOrNull(v.opened_at),
      resolvedAt: toTextOrNull(v.resolved_at),
      note: toTextOrNull(v.note),
      providerResolution: toTextOrNull(v.provider_resolution),
      providerResolvedAt: toTextOrNull(v.provider_resolved_at),
      needsDecision: toBoolean(v.needs_decision),
    })
  }

  return rows
}

function parseWebhookRows(value: unknown): WebhookRow[] {
  const rows: WebhookRow[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) continue

    rows.push({
      eventType: toTextOrNull(v.event_type),
      status: toText(v.status),
      receivedAt: toTextOrNull(v.received_at),
      processedAt: toTextOrNull(v.processed_at),
      error: toTextOrNull(v.error),
    })
  }

  return rows
}

function parseEmailRows(value: unknown): EmailRow[] {
  const rows: EmailRow[] = []

  for (const raw of asArray(value)) {
    const v = asRecord(raw)

    if (v === null) continue

    rows.push({
      kind: toText(v.kind),
      status: toText(v.status),
      createdAt: toTextOrNull(v.created_at),
    })
  }

  return rows
}

export function parseRefundQueueRow(v: Record<string, unknown>): RefundQueueRow | null {
  const id = toText(v.id)

  if (id === "") {
    return null
  }

  return {
    id,
    orderId: toText(v.order_id),
    orderNumber: toText(v.order_number),
    productTitle: toTextOrNull(v.product_title),
    amountKobo: toBigInt(v.amount_kobo),
    status: toText(v.status),
    autoApproved: toBoolean(v.auto_approved),
    requestedAt: toTextOrNull(v.requested_at),
    decidedAt: toTextOrNull(v.decided_at),
    hasProviderReference: toBoolean(v.has_provider_reference),
  }
}

export function parseRefundPage(value: unknown): Page<RefundQueueRow> {
  return pageOf(value, parseRefundQueueRow)
}

export function parseDisputeQueueRow(v: Record<string, unknown>): DisputeQueueRow | null {
  const id = toText(v.id)

  if (id === "") {
    return null
  }

  return {
    id,
    orderId: toText(v.order_id),
    orderNumber: toText(v.order_number),
    productTitle: toTextOrNull(v.product_title),
    amountKobo: toBigInt(v.amount_kobo),
    outcome: toText(v.outcome),
    openedAt: toTextOrNull(v.opened_at),
    resolvedAt: toTextOrNull(v.resolved_at),
    providerResolution: toTextOrNull(v.provider_resolution),
    providerResolvedAt: toTextOrNull(v.provider_resolved_at),
    needsDecision: toBoolean(v.needs_decision),
    maskedEmail: toText(v.masked_email),
  }
}

export function parseDisputePage(value: unknown): Page<DisputeQueueRow> {
  return pageOf(value, parseDisputeQueueRow)
}

export function parseLedgerPage(value: unknown): LedgerPage {
  const source = record(value)
  const accounts: LedgerAccount[] = []

  for (const raw of asArray(source.accounts)) {
    const v = asRecord(raw)

    if (v === null) continue

    accounts.push({
      id: toInteger(v.id),
      code: toText(v.code),
      name: toText(v.name),
      kind: toText(v.kind),
    })
  }

  return { ...pageOf(value, parseLedgerTransaction), accounts }
}

export function parseTrialBalance(value: unknown): TrialBalance {
  const v = record(value)
  const totals = record(v.totals)
  const payables = record(v.payables)
  const accounts: TrialBalanceAccount[] = []

  for (const raw of asArray(v.accounts)) {
    const row = asRecord(raw)

    if (row === null) continue

    accounts.push({
      code: toText(row.code),
      name: toText(row.name),
      kind: toText(row.kind),
      debitKobo: toBigInt(row.debit_kobo),
      creditKobo: toBigInt(row.credit_kobo),
      balanceKobo: toBigInt(row.balance_kobo),
    })
  }

  return {
    asOf: toTextOrNull(v.as_of),
    accounts,
    totals: {
      debitKobo: toBigInt(totals.debit_kobo),
      creditKobo: toBigInt(totals.credit_kobo),
      differenceKobo: toBigInt(totals.difference_kobo),
    },
    balanced: toBoolean(v.balanced),
    payables: {
      partySumKobo: toBigInt(payables.party_sum_kobo),
      accountsKobo: toBigInt(payables.accounts_kobo),
      match: toBoolean(payables.match),
    },
  }
}

export function parseReconciliationPage(value: unknown): Page<ReconciliationRun> {
  return pageOf(value, (v) => {
    const id = toText(v.id)

    if (id === "") {
      return null
    }

    return {
      id,
      runAt: toTextOrNull(v.run_at),
      ledgerBalanceKobo: toBigInt(v.ledger_paystack_balance_kobo),
      providerBalanceKobo: toBigInt(v.provider_balance_kobo),
      diffKobo: toBigInt(v.diff_kobo),
    }
  })
}

export function parseVatPeriod(v: Record<string, unknown>): VatPeriod {
  return {
    period: toText(v.period),
    status: toText(v.status) || "open",
    outputVatKobo: toBigInt(v.output_vat_kobo),
    creditNotesKobo: toBigInt(v.credit_notes_kobo),
    adjustmentsKobo: toBigInt(v.adjustments_kobo),
    netPayableKobo: toBigInt(v.net_payable_kobo),
    dueDate: toTextOrNull(v.due_date),
    daysUntilDue: toInteger(v.days_until_due),
    remittedAmountKobo: toBigInt(v.remitted_amount_kobo),
    remittedAt: toTextOrNull(v.remitted_at),
    paymentReference: toTextOrNull(v.payment_reference),
  }
}

export function parseVatPeriods(value: unknown): VatPeriod[] {
  const source = record(value)
  const periods: VatPeriod[] = []

  for (const raw of asArray(source.periods)) {
    const v = asRecord(raw)

    if (v === null) continue

    periods.push(parseVatPeriod(v))
  }

  return periods
}

export function parseVatDetail(value: unknown): VatPeriodDetail {
  const source = record(value)
  const adjustments: VatAdjustment[] = []

  for (const raw of asArray(source.adjustments)) {
    const v = asRecord(raw)

    if (v === null) continue

    adjustments.push({
      id: toText(v.id),
      period: toText(v.period),
      amountKobo: toBigInt(v.amount_kobo),
      reason: toText(v.reason),
      createdAt: toTextOrNull(v.created_at),
    })
  }

  const lines = pageOf(source.lines, (v) => {
    const id = toText(v.id)

    if (id === "") {
      return null
    }

    return {
      id,
      orderNumber: toText(v.order_number),
      paidDateLagos: toTextOrNull(v.paid_date_lagos),
      basis: toText(v.basis),
      rateBps: toInteger(v.rate_bps),
      baseKobo: toBigInt(v.base_kobo),
      taxKobo: toBigInt(v.tax_kobo),
      supplier: toText(v.supplier),
      refunded: toBoolean(v.refunded),
    }
  })

  return { summary: parseVatPeriod(record(source.summary)), adjustments, lines }
}

export function parseVatExportRows(value: unknown): VatExportRow[] {
  const source = record(value)
  const rows: VatExportRow[] = []

  for (const raw of asArray(source.rows)) {
    const v = asRecord(raw)

    if (v === null) continue

    rows.push({
      orderNumber: toText(v.order_number),
      paidDateLagos: toText(v.paid_date_lagos),
      basis: toText(v.basis),
      rateBps: toInteger(v.rate_bps),
      baseKobo: toBigInt(v.base_kobo),
      taxKobo: toBigInt(v.tax_kobo),
      supplier: toText(v.supplier),
      refunded: toBoolean(v.refunded),
    })
  }

  return rows
}

export function parseVatReminderTarget(value: unknown): VatReminderTarget | null {
  const v = asRecord(value)

  if (v === null) {
    return null
  }

  const reminder = toText(v.reminder)
  const period = toText(v.period)

  if (period === "" || (reminder !== "due_soon" && reminder !== "overdue")) {
    return null
  }

  return {
    period,
    reminder,
    dueDate: toText(v.due_date),
    netPayableKobo: toBigInt(v.net_payable_kobo),
    status: toText(v.status),
  }
}

// ---------------------------------------------------------------------------
// The needs attention panel: one row per non-zero counter.
// ---------------------------------------------------------------------------

export type AttentionItem = {
  key: string
  count: number
  /** A plain sentence, including the number. */
  sentence: string
  href: string
  linkLabel: string
}

export function attentionItems(overview: Overview): AttentionItem[] {
  const items: AttentionItem[] = []

  const add = (key: string, count: number, sentence: string, href: string, linkLabel: string): void => {
    if (count > 0) {
      items.push({ key, count, sentence, href, linkLabel })
    }
  }

  add(
    "withdrawals",
    overview.withdrawalsAwaitingApproval,
    `${count(overview.withdrawalsAwaitingApproval)} withdrawal ${one(overview.withdrawalsAwaitingApproval, "is", "are")} waiting for approval.`,
    "/withdrawals",
    "Open withdrawals",
  )
  add(
    "refunds_awaiting",
    overview.refundsAwaitingDecision,
    `${count(overview.refundsAwaitingDecision)} refund ${one(overview.refundsAwaitingDecision, "request is", "requests are")} waiting for a decision.`,
    "/transactions?tab=refunds",
    "Open refunds",
  )
  add(
    "disputes",
    overview.disputesNeedingDecision,
    `${count(overview.disputesNeedingDecision)} dispute ${one(overview.disputesNeedingDecision, "needs", "need")} your decision.`,
    "/transactions?tab=disputes",
    "Open disputes",
  )
  add(
    "failed_refunds",
    overview.failedRefundSubmissions,
    `${count(overview.failedRefundSubmissions)} refund submission ${one(overview.failedRefundSubmissions, "failed", "failed")} and can be retried.`,
    "/transactions?tab=refunds&status=failed",
    "Open refunds",
  )
  add(
    "products",
    overview.productsAwaitingReview,
    `${count(overview.productsAwaitingReview)} product ${one(overview.productsAwaitingReview, "is", "are")} waiting for review.`,
    "/products",
    "Open products",
  )
  add(
    "files",
    overview.filesNeedingScanReview,
    `${count(overview.filesNeedingScanReview)} file ${one(overview.filesNeedingScanReview, "needs", "need")} a scan review.`,
    "/security",
    "Open security",
  )
  add(
    "dead_jobs",
    overview.deadJobs,
    `${count(overview.deadJobs)} background ${one(overview.deadJobs, "job has", "jobs have")} stopped after its last attempt.`,
    "/security",
    "Open security",
  )

  return items
}

function count(value: number): string {
  return new Intl.NumberFormat("en-NG").format(value)
}

function one(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural
}
