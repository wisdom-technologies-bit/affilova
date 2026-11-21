import { LegalDocument } from "@/components/legal/legal-document"
import { buildLegalMetadata } from "@/components/legal/metadata"
import { earningsDisclaimerDocument } from "@/content/legal/earnings-disclaimer"

export const metadata = buildLegalMetadata(earningsDisclaimerDocument)

export default function EarningsDisclaimerPage() {
  return <LegalDocument document={earningsDisclaimerDocument} />
}
