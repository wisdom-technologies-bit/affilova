import { SignOutButton } from "@/components/account/sign-out-button"

// The account's own details.
//
// The name and the email are what the account holds; the email is read-only
// because changing it is an auth flow with its own confirmation, not a field on
// a page. Account deletion and data export are real rights that are handled by a
// person today, so the page says exactly that and links to the way to ask.

export function ProfilePanel({
  displayName,
  email,
}: {
  displayName: string | null
  email: string | null
}) {
  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Name
          </dt>
          <dd className="mt-1 text-sm text-brand-ink">{displayName ?? "Not set"}</dd>
        </div>

        <div className="rounded-md border border-border bg-background px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Email
          </dt>
          <dd className="mt-1 text-sm text-brand-ink">{email ?? "Not set"}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            Read-only. Ask support to change the address on your account.
          </dd>
        </div>
      </dl>

      <section aria-labelledby="profile-data" className="rounded-md border border-border px-4 py-4">
        <h2 id="profile-data" className="text-sm font-semibold text-brand-ink">
          Your data
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Account deletion and a copy of your data are available on request through the{" "}
          <a
            href="/contact"
            className="font-medium text-brand-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            contact page
          </a>{" "}
          until self-service ships. We will confirm what happens to your purchases and files before
          anything is deleted.
        </p>
      </section>

      <div>
        <SignOutButton />
      </div>
    </div>
  )
}
