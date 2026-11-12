import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getPublicEnv, getServerEnv } from "@/lib/env"

// Never import this file from client components: it holds the service role key
// and bypasses row level security. It is for route handlers, jobs and other
// server only code.

let adminClient: SupabaseClient | undefined

export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    const env = getServerEnv()
    const publicEnv = getPublicEnv()

    adminClient = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }

  return adminClient
}
