import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { termsOfServiceDocument } from "@/content/legal/terms-of-service"

export const metadata = buildLegalMetadata(termsOfServiceDocument)

export default function TermsOfServicePage() {
  return <LegalDocument document={termsOfServiceDocument} />
}
