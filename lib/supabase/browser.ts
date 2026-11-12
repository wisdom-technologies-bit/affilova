import { createBrowserClient } from "@supabase/ssr"

import { getPublicEnv } from "@/lib/env"

import { buildCookieOptions } from "./cookie-options"

// Browser side client, safe to use in client components. It only ever holds
// the public URL and anon key.
export function createSupabaseBrowserClient() {
  const env = getPublicEnv()

  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: buildCookieOptions({
      appEnv: env.NEXT_PUBLIC_APP_ENV,
      cookieDomain: env.NEXT_PUBLIC_COOKIE_DOMAIN,
    }),
  })
}
