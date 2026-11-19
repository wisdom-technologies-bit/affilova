import type { Metadata } from "next"

import { CheckoutReturnPanel } from "@/components/commerce/checkout-return-panel"
import {
  isValidReference,
  readCheckoutReference,
  type QueryValue,
} from "@/lib/commerce/checkout-return"
import { loadRetryPath } from "@/lib/commerce/checkout-retry"

// Where Paystack sends the buyer back.
//
// The reference is read from `reference` or `trxref`, validated, and then only
// ever asked about through getOrderStatusAction: this page never reads an order
// itself, so a reference cannot be used here to learn anything about one.

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Checking your payment | Affilova",
  robots: { index: false, follow: false },
}

interface PageProps {
  searchParams: Promise<Record<string, QueryValue>>
}

export default async function CheckoutReturnPage({ searchParams }: PageProps) {
  const params = await searchParams
  const candidate = readCheckoutReference(params)
  const reference = isValidReference(candidate) ? candidate : null

  const retryPath = reference === null ? null : await loadRetryPath(reference)

  return <CheckoutReturnPanel reference={reference} retryHref={retryPath ?? "/"} />
}
