import "server-only"

import { cookies } from "next/headers"

import { AFFILIATE_COOKIE_NAME, isUuid, readClickId } from "@/lib/tracking/cookie"

// What checkout knows about a click.
//
// The answer is a click id, never an affiliate id: the browser can only name a
// click, and the database decides whether that click is worth an affiliate. A
// forged, stale or foreign click id comes back as null from
// get_click_attribution, and the order is created with no affiliate.

export interface ClickAttribution {
  clickId: string
}

/**
 * The click remembered for this product, or null.
 *
 * Reading cookies is the only thing here that can fail in a way worth catching:
 * outside a request scope (a build-time render, a script) next/headers throws.
 * A checkout must never fail because attribution could not be read.
 */
export async function readAttribution(productId: string): Promise<ClickAttribution | null> {
  if (!isUuid(productId)) {
    return null
  }

  try {
    const store = await cookies()
    const clickId = readClickId(store.get(AFFILIATE_COOKIE_NAME)?.value, productId)

    return clickId === null ? null : { clickId }
  } catch {
    return null
  }
}
