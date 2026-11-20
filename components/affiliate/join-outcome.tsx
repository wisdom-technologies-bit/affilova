import Link from "next/link"

// What the join page says, in its two and only two shapes.
//
// Success names the product, because that is what the affiliate just gained.
// Every failure is the same neutral sentence: an expired token, a revoked one, a
// token that never existed and a token already used up all look identical, so the
// page cannot be used to probe which invites exist.

export function JoinOutcome({
  outcome,
  affiliateUrl,
}: {
  outcome: { ok: true; productTitle: string } | { ok: false }
  affiliateUrl: string
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-brand-ink">
        {outcome.ok ? "Invitation accepted" : "This invite is not valid"}
      </h1>

      {outcome.ok ? (
        <>
          <p className="mt-3 text-sm text-brand-ink">
            You can now promote {outcome.productTitle}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a link from the marketplace, then share it anywhere. Every click it records is
            counted for you.
          </p>
          <p className="mt-6">
            <Link
              href={affiliateUrl}
              className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Go to your affiliate dashboard
            </Link>
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          It may have expired, been used already, or been withdrawn. Ask the vendor for a new one.
        </p>
      )}
    </main>
  )
}
