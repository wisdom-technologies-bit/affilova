import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const DB_CHECK_TIMEOUT_MS = 3000

type ProbeOutcome = { reachable: boolean }

// True only when a one row read of app_migrations succeeds. A missing
// environment variable, a network error, a missing table or a timeout all
// count as unreachable.
async function isDatabaseReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const admin = getSupabaseAdminClient()

    const probe = admin
      .from("app_migrations")
      .select("*")
      .limit(1)
      .then((response): ProbeOutcome => ({ reachable: response.error === null }))

    const timeout = new Promise<ProbeOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ reachable: false }), DB_CHECK_TIMEOUT_MS)
    })

    const outcome = await Promise.race([probe, timeout])

    return outcome.reachable
  } catch {
    return false
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

// Always answers 200 with ok true. The response deliberately carries no error
// details, so it is safe to expose publicly.
export async function GET(): Promise<NextResponse> {
  let db = false

  try {
    db = await isDatabaseReachable()
  } catch {
    db = false
  }

  return NextResponse.json(
    { ok: true, time: new Date().toISOString(), db },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  )
}
