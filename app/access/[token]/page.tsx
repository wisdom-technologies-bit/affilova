import type { Metadata } from "next"

import { AccessView } from "@/components/commerce/access-view"
import { loadAccessGrant } from "@/lib/commerce/access"

// A download link is never cached and never indexed: the page exists only while
// the buyer is looking at it, and a search result pointing at it would be a
// public door with a key in the URL.

export const dynamic = "force-dynamic"

export const revalidate = 0

export const metadata: Metadata = {
  title: "Your downloads | Affilova",
  robots: { index: false, follow: false, nocache: true },
}

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function AccessPage({ params }: PageProps) {
  const { token } = await params
  const grant = await loadAccessGrant(token)

  return <AccessView grant={grant} token={token} now={new Date()} />
}
