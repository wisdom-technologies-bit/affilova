import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { affiliateAgreementDocument } from "@/content/legal/affiliate-agreement"

export const metadata = buildLegalMetadata(affiliateAgreementDocument)

export default function AffiliateAgreementPage() {
  return <LegalDocument document={affiliateAgreementDocument} />
}
