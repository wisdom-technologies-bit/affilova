import Link from "next/link"

import { ArrowRight, CheckCircle, WarningCircle } from "@/components/ds/icons"
import { Button } from "@/components/ui/button"

// What the join page says, in its two and only two shapes.
//
// Success names the product, because that is what the affiliate just gained, and
// offers the one thing to do next. Every failure is the same neutral sentence: an
// expired token, a revoked one, a token that never existed and a token already
// used up all look identical, so the page cannot be used to probe which invites
// exist. A failure has no action, because there is nothing here to act on: the
// vendor is the one who sends a new link.
//
// The two other outcomes of a join link are redirects, not cards: signed out goes
// to sign-in with this page as the next path, and signed in without the affiliate
// role goes to the affiliate setup. Both keep the invitation for the trip back.

export type JoinOutcomeValue = { ok: true; productTitle: string } | { ok: false }

export function JoinOutcome({
  outcome,
  affiliateUrl,
}: {
  outcome: JoinOutcomeValue
  affiliateUrl: string
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-6 py-16">
      <div className="rounded-lg border border-border bg-background p-8">
        {outcome.ok ? (
          <CheckCircle size="lg" tone="success" className="text-success" />
        ) : (
          <WarningCircle size="lg" className="text-text-subtle" />
        )}

        <h1 className="mt-4 text-h1 text-foreground">
          {outcome.ok ? "Invitation accepted" : "This invite is not valid"}
        </h1>

        {outcome.ok ? (
          <>
            <p className="mt-3 text-body text-text-muted">
              You can now promote{" "}
              <span className="font-medium text-foreground">{outcome.productTitle}</span>.
            </p>
            <p className="mt-2 text-body text-text-muted">
              Create a link from the marketplace, then share it anywhere. Every click it records is
              counted for you.
            </p>
            <Button asChild className="mt-6">
              <Link href={affiliateUrl}>
                Go to your affiliate dashboard
                <ArrowRight size="sm" />
              </Link>
            </Button>
          </>
        ) : (
          <p className="mt-3 text-body text-text-muted">
            It may have expired, been used already, or been withdrawn. Ask the vendor for a new one.
          </p>
        )}
      </div>
    </main>
  )
}
