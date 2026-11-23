import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"

// Support, honestly.
//
// There is no ticket system yet, so this page does not pretend there is one. It
// says how to reach a person, what to include so the first reply can be useful,
// and links to the contact page.

export default function AccountSupportPage() {
  return (
    <>
      <PageHeader title="Support" />

      <div className="max-w-2xl space-y-6">
        <section aria-labelledby="support-contact" className="rounded-md border border-border px-4 py-4">
          <h2 id="support-contact" className="text-sm font-semibold text-brand-ink">
            How to get help
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Send us a message through the{" "}
            <Link
              href="/contact"
              className="font-medium text-brand-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              contact page
            </Link>
            . A person reads it and replies to the email address on your account.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            There is no ticket system yet, so you will not get a ticket number: you get a reply.
          </p>
        </section>

        <section aria-labelledby="support-include" className="rounded-md border border-border px-4 py-4">
          <h2 id="support-include" className="text-sm font-semibold text-brand-ink">
            What to include
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>The order number, which starts with AFV- and is on your receipt.</li>
            <li>What you expected to happen and what happened instead.</li>
            <li>
              For a file that will not open: the file name and the app you used to open it.
            </li>
          </ul>
        </section>

        <section aria-labelledby="support-refunds" className="rounded-md border border-border px-4 py-4">
          <h2 id="support-refunds" className="text-sm font-semibold text-brand-ink">
            Refunds
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A refund is requested from the purchase itself while its refund window is open. After
            that, contact us with the order number and we will look at it with the vendor.
          </p>
        </section>
      </div>
    </>
  )
}
