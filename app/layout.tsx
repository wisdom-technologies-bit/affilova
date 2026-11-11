import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

import ClientWrapper from "./ClientWrapper"
import { HideV0Badge } from "@/components/HideV0Badge"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Affilova",
  description:
    "The premier affiliate marketplace connecting vendors and affiliates. Sell digital products, manage your affiliate program, and earn competitive commissions with Affilova.",
  openGraph: {
    title: "Affilova - Affiliate Marketplace Platform",
    description:
      "The premier affiliate marketplace connecting vendors and affiliates. Sell digital products, manage your affiliate program, and earn competitive commissions.",
    type: "website",
    url: "https://affilova.vercel.app",
    siteName: "Affilova",
  },
  twitter: {
    card: "summary_large_image",
    title: "Affilova - Affiliate Marketplace Platform",
    description: "The premier affiliate marketplace connecting vendors and affiliates.",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#14A953" />
      </head>
      <body className={inter.className}>
        <HideV0Badge />
        <ClientWrapper>{children}</ClientWrapper>
      </body>
    </html>
  )
}
