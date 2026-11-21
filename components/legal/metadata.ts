import type { Metadata } from "next"

import type { LegalDocumentData } from "@/content/legal"

export function buildLegalMetadata(doc: LegalDocumentData): Metadata {
  const fullTitle = `${doc.title} — Affilova`
  return {
    title: fullTitle,
    description: doc.description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: doc.href,
    },
    openGraph: {
      title: fullTitle,
      description: doc.description,
      type: "website",
      url: doc.href,
    },
  }
}

export const LEGAL_INDEX_METADATA: Metadata = {
  title: "Legal Policies & Agreements — Affilova",
  description:
    "Read Affilova's Terms of Service, Privacy Policy, Refund Policy, Vendor Agreement, Affiliate Agreement, Acceptable Use Policy, Cookie Policy, Copyright Policy and Earnings Disclaimer.",
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/legal",
  },
  openGraph: {
    title: "Legal Policies & Agreements — Affilova",
    description:
      "All public terms, policies and agreements governing use of the Affilova marketplace.",
    type: "website",
    url: "/legal",
  },
}
