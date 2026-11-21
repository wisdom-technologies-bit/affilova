import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { privacyPolicyDocument } from "@/content/legal/privacy-policy"

export const metadata = buildLegalMetadata(privacyPolicyDocument)

export default function PrivacyPolicyPage() {
  return <LegalDocument document={privacyPolicyDocument} />
}
