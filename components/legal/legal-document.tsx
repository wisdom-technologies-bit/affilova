import type { ReactNode } from "react"
import Link from "next/link"

import GlobalFooter from "@/components/global-footer"
import {
  LEGAL_DOCUMENTS,
  type LegalBlock,
  type LegalDocumentData,
  type RichText,
} from "@/content/legal"
import { LEGAL, POLICY_STATUS, legalIdentityLine, type PolicyStatus } from "@/lib/site-config"

import { LegalHeader } from "./legal-header"

const INLINE_LINK_CLASS =
  "focus-ring rounded-sm font-medium text-brand-600 underline underline-offset-2 transition-colors duration-150 hover:text-brand-700"

function renderRichText(text: RichText): ReactNode {
  if (typeof text === "string") {
    return text
  }

  return text.map((segment, index) => {
    if (typeof segment === "string") {
      return segment
    }

    if ("term" in segment) {
      return (
        <strong key={`term-${index}`} className="font-medium text-foreground">
          {segment.term}
        </strong>
      )
    }

    return (
      <Link key={`link-${index}`} href={segment.link.href} className={INLINE_LINK_CLASS}>
        {segment.link.label}
      </Link>
    )
  })
}

function renderSectionBlocks(blocks: readonly LegalBlock[], sectionNumber: number): ReactNode[] {
  let clauseNumber = 0

  return blocks.map((block, blockIndex) => {
    if (block.type === "paragraph") {
      return (
        <p key={`block-${blockIndex}`} className="text-body leading-7 text-text-muted">
          {renderRichText(block.text)}
        </p>
      )
    }

    if (block.type === "list") {
      return (
        <ul
          key={`block-${blockIndex}`}
          className="list-disc space-y-2 pl-6 text-body leading-7 text-text-muted"
        >
          {block.items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderRichText(item)}</li>
          ))}
        </ul>
      )
    }

    return (
      <ol key={`block-${blockIndex}`} className="space-y-3 text-body leading-7 text-text-muted">
        {block.items.map((item, itemIndex) => {
          clauseNumber += 1
          const label = `${sectionNumber}.${clauseNumber}`
          return (
            <li key={`clause-${itemIndex}`} className="flex gap-3">
              <span className="tabular min-w-[2.5rem] shrink-0 font-mono text-small font-medium leading-7 text-text-subtle">
                {label}
              </span>
              <span className="min-w-0 flex-1">{renderRichText(item)}</span>
            </li>
          )
        })}
      </ol>
    )
  })
}

export interface LegalDocumentProps {
  document: LegalDocumentData
  policyStatus?: PolicyStatus
  identityLine?: string
  contactPath?: string
  allDocuments?: readonly LegalDocumentData[]
}

export function LegalDocument({
  document,
  policyStatus = POLICY_STATUS,
  identityLine = legalIdentityLine(),
  contactPath = LEGAL.contactPath,
  allDocuments = LEGAL_DOCUMENTS,
}: LegalDocumentProps) {
  const otherDocuments = allDocuments.filter((entry) => entry.slug !== document.slug)
  const cleanIdentityLine = identityLine.trim()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LegalHeader currentHref={document.href} />

      <main className="legal-document-main container-reading px-5 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Breadcrumb" className="legal-no-print mb-6 text-small print:hidden">
          <Link
            href="/legal"
            className="focus-ring rounded-sm font-medium text-brand-600 underline-offset-2 hover:underline"
          >
            &larr; All legal policies
          </Link>
        </nav>

        {policyStatus === "draft" ? (
          <aside
            aria-label="Document status notice"
            className="mb-8 rounded-md border border-warning/40 bg-warning-subtle px-4 py-3 text-dense text-warning"
          >
            <p className="font-medium">Draft pending legal review</p>
            <p className="mt-1 leading-relaxed">
              This document is a working draft prepared for review by Nigerian legal counsel before final publication.
            </p>
          </aside>
        ) : null}

        <header className="border-b border-border pb-6">
          <p className="text-caption font-medium text-brand-600">Affilova Legal</p>
          <h1 className="mt-3 text-h1 text-foreground sm:text-display-sm">
            {document.title}
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-small text-text-muted">
            <div className="flex items-center gap-1.5">
              <dt className="font-medium text-foreground">Effective date:</dt>
              <dd>{document.effectiveDate}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="font-medium text-foreground">Version:</dt>
              <dd className="tabular font-mono text-caption sm:text-small">{document.version}</dd>
            </div>
          </dl>
        </header>

        <section
          aria-labelledby="legal-summary-heading"
          className="mt-8 rounded-md border border-border bg-surface-subtle p-5 sm:p-6"
        >
          <h2 id="legal-summary-heading" className="text-h3 text-foreground">
            Plain-language summary
          </h2>
          <p className="mt-1 text-caption text-text-muted">
            This summary highlights key points and does not replace the full terms below.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-dense leading-relaxed text-text-muted">
            {document.summary.map((point, index) => (
              <li key={`summary-${index}`}>{point}</li>
            ))}
          </ul>
        </section>

        <nav
          aria-label="Table of contents"
          className="mt-8 rounded-md border border-border bg-background p-5 sm:p-6"
        >
          <h2 className="text-h3 text-foreground">Contents</h2>
          <ol className="mt-3 grid gap-2 text-dense sm:grid-cols-2">
            {document.sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="focus-ring inline-flex gap-2 rounded-sm text-text-muted underline-offset-2 hover:text-brand-600 hover:underline"
                >
                  <span className="tabular font-mono text-caption font-medium leading-5 text-text-subtle">
                    {index + 1}.
                  </span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="mt-10 space-y-10">
          {document.sections.map((section, sectionIndex) => {
            const sectionNumber = sectionIndex + 1
            const headingId = `${section.id}-heading`
            return (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={headingId}
                className="legal-section scroll-mt-8 border-t border-border pt-8 first:border-t-0 first:pt-0"
              >
                <h2
                  id={headingId}
                  className="text-h2 text-foreground"
                >
                  <span className="tabular mr-2 font-mono text-body font-medium text-brand-600">
                    {sectionNumber}.
                  </span>
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4">
                  {renderSectionBlocks(section.blocks, sectionNumber)}
                </div>
              </section>
            )
          })}
        </article>

        <footer className="mt-12 border-t border-border pt-8">
          {cleanIdentityLine !== "" ? (
            <p className="mb-4 text-dense leading-relaxed text-text-muted">{cleanIdentityLine}</p>
          ) : null}

          <p className="text-dense text-text-muted">
            Questions about this document? Reach us through our{" "}
            <Link href={contactPath} className={INLINE_LINK_CLASS}>
              contact page
            </Link>
            .
          </p>

          <nav
            aria-label="Other legal policies"
            className="legal-no-print mt-8 rounded-md border border-border bg-surface-subtle p-5 print:hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-small font-medium text-foreground">Other Affilova policies</h2>
              <Link href="/legal" className={`text-caption ${INLINE_LINK_CLASS}`}>
                View all policies
              </Link>
            </div>
            <ul className="mt-3 grid gap-2 text-dense sm:grid-cols-2">
              {otherDocuments.map((entry) => (
                <li key={entry.slug}>
                  <Link href={entry.href} className={INLINE_LINK_CLASS}>
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </footer>
      </main>

      <GlobalFooter className="legal-no-print print:hidden" />
    </div>
  )
}
