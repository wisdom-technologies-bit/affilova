import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { vendorAgreementDocument } from "@/content/legal/vendor-agreement"

export const metadata = buildLegalMetadata(vendorAgreementDocument)

export default function VendorAgreementPage() {
  return <LegalDocument document={vendorAgreementDocument} />
}
