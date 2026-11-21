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
  "font-medium text-brand-700 underline underline-offset-2 transition-colors duration-150 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"

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
        <strong key={`term-${index}`} className="font-semibold text-slate-900">
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
        <p key={`block-${blockIndex}`} className="text-[15px] leading-7 text-slate-700">
          {renderRichText(block.text)}
        </p>
      )
    }

    if (block.type === "list") {
      return (
        <ul
          key={`block-${blockIndex}`}
          className="list-disc space-y-2 pl-6 text-[15px] leading-7 text-slate-700"
        >
          {block.items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderRichText(item)}</li>
          ))}
        </ul>
      )
    }

    return (
      <ol key={`block-${blockIndex}`} className="space-y-3 text-[15px] leading-7 text-slate-700">
        {block.items.map((item, itemIndex) => {
          clauseNumber += 1
          const label = `${sectionNumber}.${clauseNumber}`
          return (
            <li key={`clause-${itemIndex}`} className="flex gap-3">
              <span className="min-w-[2.5rem] shrink-0 font-mono text-sm font-semibold leading-7 text-slate-500">
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
    <div className="min-h-screen bg-white text-slate-900">
      <LegalHeader currentHref={document.href} />

      <main className="legal-document-main mx-auto w-full max-w-[70ch] px-5 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Breadcrumb" className="legal-no-print mb-6 text-sm print:hidden">
          <Link
            href="/legal"
            className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            &larr; All legal policies
          </Link>
        </nav>

        {policyStatus === "draft" ? (
          <aside
            aria-label="Document status notice"
            className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <p className="font-semibold">Draft pending legal review</p>
            <p className="mt-1 leading-relaxed text-amber-900">
              This document is a working draft prepared for review by Nigerian legal counsel before final publication.
            </p>
          </aside>
        ) : null}

        <header className="border-b border-[#E3E6E3] pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
            Affilova Legal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {document.title}
          </h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            <div className="flex items-center gap-1.5">
              <dt className="font-medium text-slate-700">Effective date:</dt>
              <dd>{document.effectiveDate}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="font-medium text-slate-700">Version:</dt>
              <dd className="font-mono text-xs sm:text-sm">{document.version}</dd>
            </div>
          </dl>
        </header>

        <section
          aria-labelledby="legal-summary-heading"
          className="mt-8 rounded-xl border border-[#E3E6E3] bg-[#F7F8F7] p-5 sm:p-6"
        >
          <h2 id="legal-summary-heading" className="text-base font-semibold text-slate-900">
            Plain-language summary
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            This summary highlights key points and does not replace the full terms below.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            {document.summary.map((point, index) => (
              <li key={`summary-${index}`}>{point}</li>
            ))}
          </ul>
        </section>

        <nav
          aria-label="Table of contents"
          className="mt-8 rounded-xl border border-[#E3E6E3] bg-white p-5 sm:p-6"
        >
          <h2 className="text-base font-semibold text-slate-900">Contents</h2>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {document.sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex gap-2 rounded-sm text-slate-700 underline-offset-2 hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  <span className="font-mono text-xs font-semibold leading-5 text-slate-500">
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
                className="legal-section scroll-mt-8 border-t border-[#E3E6E3] pt-8 first:border-t-0 first:pt-0"
              >
                <h2
                  id={headingId}
                  className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl"
                >
                  <span className="mr-2 font-mono text-base font-semibold text-brand-700 sm:text-lg">
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

        <footer className="mt-12 border-t border-[#E3E6E3] pt-8">
          {cleanIdentityLine !== "" ? (
            <p className="mb-4 text-sm leading-relaxed text-slate-700">{cleanIdentityLine}</p>
          ) : null}

          <p className="text-sm text-slate-600">
            Questions about this document? Reach us through our{" "}
            <Link href={contactPath} className={INLINE_LINK_CLASS}>
              contact page
            </Link>
            .
          </p>

          <nav
            aria-label="Other legal policies"
            className="legal-no-print mt-8 rounded-xl border border-[#E3E6E3] bg-[#F7F8F7] p-5 print:hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Other Affilova policies</h2>
              <Link href="/legal" className={`text-xs ${INLINE_LINK_CLASS}`}>
                View all policies
              </Link>
            </div>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
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
