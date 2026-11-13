import { NextResponse, type NextRequest } from "next/server"

import { safeNextPath } from "@/lib/identity/safe-next"
import { createSupabaseServerClient } from "@/lib/supabase/server"

// Target of the links in the Supabase auth emails:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>
//
// Supabase's verifyOtp() accepts these email token types (EmailOtpType in
// @supabase/auth-js): signup, invite, magiclink, recovery, email_change and
// email. Anything else is rejected before Supabase is called.
//
// No query value reaches the response except through safeNextPath().

type AllowedOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email"

const ALLOWED_OTP_TYPES: readonly AllowedOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]

function parseOtpType(value: string | null): AllowedOtpType | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""

  const match = ALLOWED_OTP_TYPES.find((type) => type === normalized)

  return match ?? null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url)

  const tokenHash = searchParams.get("token_hash")
  const type = parseOtpType(searchParams.get("type"))
  const next = safeNextPath(searchParams.get("next"))

  const invalid = NextResponse.redirect(new URL("/sign-in?error=link_invalid", origin))

  if (!tokenHash || type === null) {
    return invalid
  }

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

    if (error) {
      return invalid
    }
  } catch {
    return invalid
  }

  return NextResponse.redirect(new URL(next, origin))
}
