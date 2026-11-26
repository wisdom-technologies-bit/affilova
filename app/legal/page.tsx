import Link from "next/link"

import GlobalFooter from "@/components/global-footer"
import { LegalHeader } from "@/components/legal/legal-header"
import { LEGAL_INDEX_METADATA } from "@/components/legal/metadata"
import { LEGAL_DOCUMENTS, type LegalDocumentData } from "@/content/legal"
import { LEGAL, POLICY_STATUS, legalIdentityLine, type PolicyStatus } from "@/lib/site-config"

export const metadata = LEGAL_INDEX_METADATA

export interface LegalIndexViewProps {
  documents?: readonly LegalDocumentData[]
  policyStatus?: PolicyStatus
  identityLine?: string
  contactPath?: string
}

export function LegalIndexView({
  documents = LEGAL_DOCUMENTS,
  policyStatus = POLICY_STATUS,
  identityLine = legalIdentityLine(),
  contactPath = LEGAL.contactPath,
}: LegalIndexViewProps) {
  const cleanIdentityLine = identityLine.trim()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LegalHeader currentHref="/legal" />

      <main className="mx-auto w-full max-w-[70ch] px-5 py-10 sm:px-6 sm:py-14">
        {policyStatus === "draft" ? (
          <aside
            aria-label="Document status notice"
            className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <p className="font-semibold">Draft pending legal review</p>
            <p className="mt-1 leading-relaxed text-amber-900">
              These policies are working drafts prepared for review by Nigerian legal counsel before final publication.
            </p>
          </aside>
        ) : null}

        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
            Affilova Legal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Legal Policies &amp; Agreements
          </h1>
          <p className="mt-4 text-base leading-relaxed text-text-muted">
            Read the agreements and policies that govern accounts, product listings, affiliate promotions, payments, privacy and acceptable conduct on Affilova.
          </p>
        </header>

        <section aria-label="Legal documents" className="mt-8 space-y-4">
          {documents.map((doc) => (
            <article
              key={doc.slug}
              className="rounded-lg border border-border bg-background p-5 transition-colors hover:border-border-strong sm:p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  <Link
                    href={doc.href}
                    className="underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    {doc.title}
                  </Link>
                </h2>
                <span className="font-mono text-xs text-slate-500">{doc.version}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{doc.description}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Effective date: {doc.effectiveDate}</span>
                <Link
                  href={doc.href}
                  className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  Read document &rarr;
                </Link>
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-10 border-t border-border pt-6 text-sm text-text-muted">
          {cleanIdentityLine !== "" ? (
            <p className="mb-3 text-slate-700">{cleanIdentityLine}</p>
          ) : null}
          <p>
            Questions about our legal terms? Visit our{" "}
            <Link
              href={contactPath}
              className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              contact page
            </Link>
            .
          </p>
        </footer>
      </main>

      <GlobalFooter />
    </div>
  )
}

export default function LegalIndexPage() {
  return <LegalIndexView />
}
