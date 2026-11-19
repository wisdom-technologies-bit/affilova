"use client"

import { useEffect, useState } from "react"

import { getOrderStatusAction } from "@/lib/commerce/order-status"
import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  stateFromStatus,
  type CheckoutReturnState,
} from "@/lib/commerce/checkout-return"

import { CheckoutReturnView } from "./checkout-return-view"

// The polling panel.
//
// Three seconds, thirty seconds, then it stops and says what it knows. It stops
// on unmount too: a buyer who closes the tab must not leave a timer asking our
// payment partner about their order.

export interface CheckoutReturnPanelProps {
  /** The validated reference, or null when the URL carried none. */
  reference: string | null
  retryHref: string
}

export function CheckoutReturnPanel({ reference, retryHref }: CheckoutReturnPanelProps) {
  const [state, setState] = useState<CheckoutReturnState>(
    reference === null ? { kind: "missing_reference" } : { kind: "polling" },
  )

  useEffect(() => {
    if (reference === null) {
      return
    }

    let cancelled = false
    let elapsed = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const stop = (next: CheckoutReturnState): void => {
      if (!cancelled) {
        setState(next)
      }
    }

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return
      }

      try {
        const answer = await getOrderStatusAction({ reference })

        if (cancelled) {
          return
        }

        if (answer.status !== "pending") {
          stop(stateFromStatus(answer.status, answer.number))

          return
        }
      } catch {
        // A failed ask is not a failed payment: keep trying inside the window.
      }

      elapsed += POLL_INTERVAL_MS

      if (elapsed >= POLL_TIMEOUT_MS) {
        stop({ kind: "still_confirming" })

        return
      }

      timer = setTimeout(() => {
        void tick()
      }, POLL_INTERVAL_MS)
    }

    void tick()

    return () => {
      cancelled = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [reference])

  return <CheckoutReturnView state={state} retryHref={retryHref} />
}
