import { NextResponse, type NextRequest } from "next/server"

import { safeNextPath } from "@/lib/identity/safe-next"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// OAuth callback. Supabase sends the browser here with a one-time code, which is
// exchanged for a session (the PKCE half of the flow lives in the code verifier
// cookie set when the sign-in started).
//
// Everything is redirected relative to the request origin, and the only value
// taken from the query string is "next", through safeNextPath().

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url)

  const code = searchParams.get("code")
  const next = safeNextPath(searchParams.get("next"))

  const failed = NextResponse.redirect(new URL("/sign-in?error=callback_failed", origin))

  if (!code) {
    return failed
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      return failed
    }
  } catch {
    return failed
  }

  return NextResponse.redirect(new URL(next, origin))
}
