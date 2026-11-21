import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { refundPolicyDocument } from "@/content/legal/refund-policy"

export const metadata = buildLegalMetadata(refundPolicyDocument)

export default function RefundPolicyPage() {
  return <LegalDocument document={refundPolicyDocument} />
}
