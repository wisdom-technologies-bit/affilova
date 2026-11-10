"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

export default function GlobalLoadingIndicator() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // When route changes, show loading briefly then hide
    setIsLoading(true)
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [pathname, searchParams])

  // Listen for link clicks to show loading indicator
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest("a")
      if (anchor && anchor.href && !anchor.href.startsWith("#") && !anchor.target) {
        const url = new URL(anchor.href)
        if (url.origin === window.location.origin && url.pathname !== pathname) {
          setIsLoading(true)
        }
      }
    }

    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [pathname])

  if (!isLoading) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 bg-white shadow-lg rounded-full p-3 border border-green-200 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
    </div>
  )
}
