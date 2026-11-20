import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { JoinOutcome } from "@/components/affiliate/join-outcome"
import { acceptInviteAction } from "@/lib/affiliate/actions"
import { getLiveProductTitle } from "@/lib/affiliate/read-actions"
import { appUrl } from "@/lib/identity/app-urls"
import { getAuthUser, getUserRoles } from "@/lib/identity/session"

// The public join page for an invitation link.
//
// Signed out: to sign in, then straight back here. Signed in without the
// affiliate role: to the affiliate sign-up, which keeps the invitation for the
// trip back. Signed in as an affiliate: accept it, once.
//
// The token is in the path and is never echoed back on the page, never logged,
// and never shown after this request. Every failure reads the same.

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Join as an affiliate",
  robots: { index: false, follow: false },
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getAuthUser()

  if (user === null) {
    redirect(`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`)
  }

  const roles = await getUserRoles(user.id)

  if (!roles.includes("affiliate")) {
    redirect("/start/affiliate")
  }

  const result = await acceptInviteAction({ token })

  if (!result.ok) {
    return <JoinOutcome outcome={{ ok: false }} affiliateUrl={appUrl("affiliate", "/")} />
  }

  const productTitle = await getLiveProductTitle(result.productId)

  if (productTitle === null) {
    return <JoinOutcome outcome={{ ok: false }} affiliateUrl={appUrl("affiliate", "/")} />
  }

  return (
    <JoinOutcome
      outcome={{ ok: true, productTitle }}
      affiliateUrl={appUrl("affiliate", "/")}
    />
  )
}
