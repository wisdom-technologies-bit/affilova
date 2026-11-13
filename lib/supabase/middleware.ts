import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"

import { getPublicEnv } from "@/lib/env"

import { buildCookieOptions } from "./cookie-options"

// Session refresh for the Next.js middleware.
//
// Follows the current Supabase guide "Setting up Server-Side Auth for Next.js":
// the middleware client reads the auth cookies from the request and writes any
// refreshed ones to the response, so server components, which cannot set
// cookies, see the new token on their next request.
//
// The response is passed in rather than created here: the caller decides what
// the response is (a rewrite, a redirect, a plain next()) and this function only
// adds the session cookies and headers to it. It is deliberately not wired into
// middleware.ts yet.

export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const env = getPublicEnv()

  const cookieOptions = buildCookieOptions({
    appEnv: env.NEXT_PUBLIC_APP_ENV,
    cookieDomain: env.NEXT_PUBLIC_COOKIE_DOMAIN,
  })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          // The request copy is what the rest of this request reads.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          // The response copy is what the browser stores.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, { ...options, ...cookieOptions })
          })

          // Auth responses must not be cached by a CDN or a proxy, otherwise one
          // user's session can be served to another.
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value)
          })
        },
      },
    },
  )

  // Refreshes an expired token and writes the new cookies through setAll above.
  // getUser() is the verifying call; getSession() would trust the cookie.
  await supabase.auth.getUser()

  return response
}
