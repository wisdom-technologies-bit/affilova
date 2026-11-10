import type { Metadata } from "next"
import HowItWorksClient from "./HowItWorksClient"

export const metadata: Metadata = {
  title: "How It Works - Complete Guide to Affilova | Affiliate Marketing Platform",
  description:
    "Learn everything about Affilova - from signing up to earning your first commission. A comprehensive guide for vendors and affiliates on our affiliate marketing platform.",
  keywords:
    "affiliate marketing guide, how to sell digital products, affiliate program tutorial, earn commissions online, digital product marketplace",
  openGraph: {
    title: "How Affilova Works - Complete Guide",
    description: "Your comprehensive guide to succeeding on Affilova's affiliate marketplace",
    type: "article",
  },
}

export default function HowItWorksPage() {
  return <HowItWorksClient />
}
