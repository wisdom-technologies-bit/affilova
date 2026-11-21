import { acceptableUseDocument } from "./acceptable-use"
import { affiliateAgreementDocument } from "./affiliate-agreement"
import { cookiePolicyDocument } from "./cookie-policy"
import { copyrightPolicyDocument } from "./copyright-policy"
import { earningsDisclaimerDocument } from "./earnings-disclaimer"
import { privacyPolicyDocument } from "./privacy-policy"
import { refundPolicyDocument } from "./refund-policy"
import { termsOfServiceDocument } from "./terms-of-service"
import type { LegalBlock, LegalDocumentData, RichText } from "./types"
import { vendorAgreementDocument } from "./vendor-agreement"

export type { InlineSegment, LegalBlock, LegalDocumentData, LegalSection, RichText } from "./types"

export const LEGAL_DOCUMENTS: readonly LegalDocumentData[] = [
  termsOfServiceDocument,
  privacyPolicyDocument,
  refundPolicyDocument,
  acceptableUseDocument,
  vendorAgreementDocument,
  affiliateAgreementDocument,
  cookiePolicyDocument,
  copyrightPolicyDocument,
  earningsDisclaimerDocument,
]

export const LEGAL_DOCUMENTS_BY_SLUG: Record<string, LegalDocumentData> = Object.fromEntries(
  LEGAL_DOCUMENTS.map((doc) => [doc.slug, doc]),
)

export function richTextToPlain(text: RichText): string {
  if (typeof text === "string") {
    return text
  }

  return text
    .map((segment) => {
      if (typeof segment === "string") {
        return segment
      }
      if ("term" in segment) {
        return segment.term
      }
      return segment.link.label
    })
    .join("")
}

export function blockToPlain(block: LegalBlock): string {
  if (block.type === "paragraph") {
    return richTextToPlain(block.text)
  }

  return block.items.map(richTextToPlain).join("\n")
}

export function documentToPlain(doc: LegalDocumentData): string {
  return [
    doc.title,
    doc.description,
    ...doc.summary,
    ...doc.sections.flatMap((section) => [section.title, ...section.blocks.map(blockToPlain)]),
  ].join("\n")
}
