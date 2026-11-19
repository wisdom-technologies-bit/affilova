import Link from "next/link"

import {
  returnMessage,
  type CheckoutReturnState,
  type Tone,
} from "@/lib/commerce/checkout-return"

// The return page, without the polling.
//
// The words for every state live in lib/commerce/checkout-return.ts, so the page,
// the panel and the tests all read the same sentences. Status is never carried by
// colour: each state has a heading, and the border is decoration on top of it.

export interface CheckoutReturnViewProps {
  state: CheckoutReturnState
  /** Where "Try again" goes: the product page, when it can be resolved. */
  retryHref: string
}

const TONE_BORDER: Readonly<Record<Tone, string>> = {
  positive: "border-brand-600",
  neutral: "border-border",
  attention: "border-amber-400",
}

export function CheckoutReturnView({ state, retryHref }: CheckoutReturnViewProps) {
  const message = returnMessage(state)

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section
        aria-labelledby="return-heading"
        className={`rounded-lg border bg-card p-6 ${TONE_BORDER[message.tone]}`}
      >
        <h1 id="return-heading" className="text-2xl font-semibold tracking-tight text-foreground">
          {message.heading}
        </h1>
        <p className="mt-3 text-base text-foreground">{message.body}</p>

        {message.busy ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
            Asking our payment partner…
          </p>
        ) : null}

        {message.retry ? (
          <p className="mt-6">
            <Link
              href={retryHref}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Try again
            </Link>
          </p>
        ) : null}
      </section>

      <p className="mt-6 text-sm text-muted-foreground">
        Need help?{" "}
        <Link
          href="/contact"
          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Contact us
        </Link>{" "}
        or{" "}
        <Link
          href="/access/resend"
          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          send yourself a new download link
        </Link>
        .
      </p>
    </main>
  )
}
