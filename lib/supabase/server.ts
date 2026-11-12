import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getPublicEnv } from "@/lib/env"

import { buildCookieOptions } from "./cookie-options"

// Server side client for route handlers, server components and server actions.
// Create a new one per request: it reads the request cookies once.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const env = getPublicEnv()

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: buildCookieOptions({
      appEnv: env.NEXT_PUBLIC_APP_ENV,
      cookieDomain: env.NEXT_PUBLIC_COOKIE_DOMAIN,
    }),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session there, so ignoring this is safe.
        }
      },
    },
  })
}
