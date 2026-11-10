import { type NextRequest, NextResponse } from "next/server"
import { getGoogleAuthUrl } from "@/lib/google-auth"
import { getClientIP, verifyTurnstileToken, logSecurityEvent } from "@/lib/security"

export async function GET() {
  // Legacy GET support - redirect directly (no verification)
  const authUrl = getGoogleAuthUrl()
  return NextResponse.redirect(authUrl)
}

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"

  try {
    const body = await request.json()
    const { turnstileToken } = body

    // Verify Turnstile token
    if (!turnstileToken) {
      await logSecurityEvent("google_auth_missing_token", null, clientIP, false, userAgent)
      return NextResponse.json({ error: "Security verification token required" }, { status: 400 })
    }

    const turnstileValid = await verifyTurnstileToken(turnstileToken, clientIP)
    if (!turnstileValid) {
      await logSecurityEvent("google_auth_turnstile_failed", null, clientIP, false, userAgent)
      return NextResponse.json({ error: "Security verification failed" }, { status: 400 })
    }

    // Log successful verification
    await logSecurityEvent("google_auth_verified", null, clientIP, true, userAgent)

    const authUrl = getGoogleAuthUrl()
    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error("Google auth route error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
