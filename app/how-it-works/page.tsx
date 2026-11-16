import type { Metadata } from "next"

import HowItWorksClient from "./HowItWorksClient"

export const metadata: Metadata = {
  title: "How It Works | Affilova",
  description:
    "How Affilova works for vendors, affiliates and customers: what each role does, what the platform fee is, and who sets the commission on a product.",
  openGraph: {
    title: "How Affilova works",
    description: "What vendors, affiliates and customers do on Affilova, and what the platform fee is.",
    type: "article",
  },
}

export default function HowItWorksPage() {
  return <HowItWorksClient />
}
