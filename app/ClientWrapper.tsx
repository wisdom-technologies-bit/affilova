"use client"

import type React from "react"

import { useEffect, Suspense } from "react"
import GlobalLoadingIndicator from "@/components/global-loading-indicator"

function LoadingIndicatorWrapper() {
  return <GlobalLoadingIndicator />
}

export default function ClientWrapper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const removeV0Badge = () => {
      const badge = document.querySelector('div[style*="v0"], div[aria-label*="v0"], .v0-badge')
      if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge)
        console.log("✔️ Removed 'Built with v0' badge")
      }
    }

    removeV0Badge()
    setTimeout(removeV0Badge, 1500)
  }, [])

  return (
    <>
      {children}
      <Suspense fallback={null}>
        <LoadingIndicatorWrapper />
      </Suspense>
    </>
  )
}
