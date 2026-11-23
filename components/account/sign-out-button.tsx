"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { signOutAction } from "@/app/auth/actions"

// Signing out of the account app. The session is ended by the existing auth
// action; this only reports that it happened and sends the person to the sign-in
// page.

export function SignOutButton() {
  const router = useRouter()
  const [working, setWorking] = useState(false)

  async function signOut(): Promise<void> {
    setWorking(true)
    await signOutAction()
    router.push("/sign-in")
  }

  return (
    <button
      type="button"
      onClick={() => {
        void signOut()
      }}
      disabled={working}
      className="inline-flex min-h-[44px] items-center rounded-md border border-input px-4 text-sm font-medium text-brand-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {working ? "Signing out…" : "Sign out"}
    </button>
  )
}
