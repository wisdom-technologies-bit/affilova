import type React from "react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy - Affilova | Your Data Protection",
  description:
    "Learn how Affilova protects your personal data and privacy. Our comprehensive privacy policy explains data collection and usage.",
}

export default function PrivacyPolicyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
