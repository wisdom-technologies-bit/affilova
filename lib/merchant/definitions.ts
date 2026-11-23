// The words behind the merchant numbers.
//
// One place for the label and the plain definition, so a KPI card, its hover
// text and the disclosure underneath can never drift apart. These are the
// definitions the database function implements; nothing here reads the database
// or the clock.

import type { MetricDefinition } from "@/lib/affiliate/definitions"

export const VENDOR_METRICS = {
  orders: {
    label: "Orders",
    definition: "Paid orders that included one of your products in the selected days.",
    how: "Counted once per order. A refunded order stays counted here, because it was still an order.",
  },
  gross: {
    label: "Gross sales",
    definition: "What buyers paid for your products in the selected days.",
    how: "The price of your items, before the platform fee, the affiliate commission and VAT.",
  },
  net: {
    label: "Your earnings",
    definition: "What is left for you after the platform fee, the affiliate commission and VAT.",
    how: "Gross sales minus the platform fee, minus any affiliate commission, minus the VAT carved out of the platform fee.",
  },
  refunds: {
    label: "Refunds",
    definition: "Refunded orders in the selected days, and what share of your sales they are.",
    how: "The count and value of your items on refunded orders, divided by gross sales, in percent.",
  },
  pending: {
    label: "Pending balance",
    definition: "Earned money that is still inside the hold, not yet withdrawable.",
    how: "Ledger credits whose hold has not ended yet. The hold is 7 days after payment.",
  },
  available: {
    label: "Available balance",
    definition: "Earned money that has left the hold.",
    how: "Everything credited to you, minus what is still pending, and never below zero.",
  },
  affiliateShare: {
    label: "Affiliate share",
    definition: "How many of your orders came through an affiliate link.",
    how: "Orders with an affiliate attached, divided by all orders in the range.",
  },
} satisfies Record<string, MetricDefinition>

/** The definitions shown under the cards, in the order they are shown. */
export const VENDOR_METRIC_LIST: readonly MetricDefinition[] = [
  VENDOR_METRICS.orders,
  VENDOR_METRICS.gross,
  VENDOR_METRICS.net,
  VENDOR_METRICS.refunds,
  VENDOR_METRICS.pending,
  VENDOR_METRICS.available,
]

/** The note that keeps the screen honest until payouts exist. */
export const WITHDRAWALS_NOTE = "Withdrawals are not available yet."
