import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { createPasswordResetToken } from "@/lib/password-reset"
import { brevoService } from "@/lib/brevo"
import { getClientIP, isValidEmail, checkIPRateLimit, logSecurityEvent } from "@/lib/security"
import { z } from "zod"

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"

  try {
    const body = await request.json()
    const { email } = forgotPasswordSchema.parse(body)

    // Validate email format
    if (!isValidEmail(email)) {
      await logSecurityEvent("forgot_password_invalid_email", email, clientIP, false, userAgent)
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, we've sent a password reset link.",
      })
    }

    // Check IP-based rate limiting (5 requests per 10 minutes)
    const ipRateLimitCheck = await checkIPRateLimit(clientIP, "forgot_password", 5)
    if (!ipRateLimitCheck.allowed) {
      await logSecurityEvent("forgot_password_ip_rate_limit", email, clientIP, false, userAgent)
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, we've sent a password reset link.",
      })
    }

    // Find user by email
    const [user] = await sql`
      SELECT alphanumeric_id, email, first_name, is_active
      FROM users 
      WHERE email = ${email}
    `

    // Always return success to prevent email enumeration
    if (!user || !user.is_active) {
      await logSecurityEvent("forgot_password_user_not_found", email, clientIP, false, userAgent)
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, we've sent a password reset link.",
      })
    }

    // Create reset token
    const resetToken = await createPasswordResetToken(user.alphanumeric_id)

    // Send reset email
    await brevoService.sendPasswordResetEmail(user.email, user.first_name, resetToken)

    // Log successful password reset request
    await logSecurityEvent("forgot_password_email_sent", email, clientIP, true, userAgent)

    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, we've sent a password reset link.",
    })
  } catch (error) {
    console.error("Forgot password error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, we've sent a password reset link.",
      })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
