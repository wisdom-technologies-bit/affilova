import { randomUUID } from "node:crypto"

import { getPublicEnv } from "@/lib/env"
import { clientIpFromHeaders, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { cookieValueFromHeader, handleClick } from "@/lib/tracking/click"
import { getLinkTarget, recordClick } from "@/lib/tracking/db"
import { hashIp, hashUa } from "@/lib/tracking/hash"

// The tracked link: GET /r/<code>
//
// The whole decision lives in lib/tracking/click.ts, which is tested without a
// Next.js runtime. This file only reads the request and the environment.
//
// It is dynamic and never cached: a redirect that a CDN remembered would stop
// recording clicks, and the same answer would be served to a bot and a person.

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ code: string }> }

function isProduction(): boolean {
  try {
    return getPublicEnv().NEXT_PUBLIC_APP_ENV === "production"
  } catch {
    // A deployment without its public environment set is not production.
    return false
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { code } = await context.params
  const url = new URL(request.url)

  try {
    return await handleClick(
      {
        code,
        searchParams: url.searchParams,
        headers: request.headers,
        cookieValue: cookieValueFromHeader(request.headers.get("cookie")),
        production: isProduction(),
        clientIp: clientIpFromHeaders(request.headers),
      },
      {
        rateLimit,
        hashIp,
        hashUa,
        recordClick,
        getLinkTarget,
        newClickId: randomUUID,
        now: () => new Date(),
        rateLimitKey,
      },
    )
  } catch {
    // Nothing on this path may show an error page to someone who just followed a
    // link. A failure is a trip home.
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
        "Referrer-Policy": "no-referrer",
      },
    })
  }
}
