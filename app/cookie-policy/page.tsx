import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { cookiePolicyDocument } from "@/content/legal/cookie-policy"

export const metadata = buildLegalMetadata(cookiePolicyDocument)

export default function CookiePolicyPage() {
  return <LegalDocument document={cookiePolicyDocument} />
}
