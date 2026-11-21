import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { copyrightPolicyDocument } from "@/content/legal/copyright-policy"

export const metadata = buildLegalMetadata(copyrightPolicyDocument)

export default function CopyrightPage() {
  return <LegalDocument document={copyrightPolicyDocument} />
}
