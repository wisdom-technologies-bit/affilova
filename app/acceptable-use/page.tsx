import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { acceptableUseDocument } from "@/content/legal/acceptable-use"

export const metadata = buildLegalMetadata(acceptableUseDocument)

export default function AcceptableUsePage() {
  return <LegalDocument document={acceptableUseDocument} />
}
