import Link from "next/link"

import { CARD_FOCUS } from "./product-card"

// What a visitor sees when they have searched too often.
//
// The limit is generous (120 searches a minute from one address), so reaching it
// means something automated is asking, not a person. The message says what
// happened, says nothing about them, and offers the plain listing, which is not
// limited.

export function SearchLimited({ basePath }: { basePath: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Too many searches</h1>
      <p aria-live="polite" className="mt-3 text-base text-muted-foreground">
        That is a lot of searching in a short time. Please wait a minute and try again.
      </p>
      <p className="mt-2 text-base text-muted-foreground">
        You can still browse everything without searching.
      </p>
      <Link
        href={basePath}
        className={`mt-6 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted ${CARD_FOCUS}`}
      >
        Browse all products
      </Link>
    </main>
  )
}
