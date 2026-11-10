import { type NextRequest, NextResponse } from "next/server"
import { createOTP, sendOTPEmail } from "@/lib/otp"
import { sql } from "@/lib/db"
import {
  getClientIP,
  isValidEmail,
  validateSignupInput,
  checkOTPRateLimit,
  checkIPRateLimit,
  logSecurityEvent,
  verifyTurnstileToken,
} from "@/lib/security"
import { z } from "zod"

const sendOTPSchema = z.object({
  email: z.string().email(),
  type: z.enum(["registration", "login", "password_reset"]),
  turnstileToken: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"

  try {
    const body = await request.json()
    const { email, type, turnstileToken, firstName, lastName } = sendOTPSchema.parse(body)

    // Validate email format
    if (!isValidEmail(email)) {
      await logSecurityEvent("otp_invalid_email_format", email, clientIP, false, userAgent)
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    // Check IP-based rate limiting (5 requests per 10 minutes)
    const ipRateLimitCheck = await checkIPRateLimit(clientIP, `otp_${type}`, 5)
    if (!ipRateLimitCheck.allowed) {
      await logSecurityEvent("otp_ip_rate_limit_exceeded", email, clientIP, false, userAgent, { type })
      return NextResponse.json({ error: ipRateLimitCheck.message }, { status: 429 })
    }

    // Check email+IP rate limiting (3 requests per 15 minutes)
    const emailRateLimitCheck = await checkOTPRateLimit(email, clientIP)
    if (!emailRateLimitCheck.allowed) {
      await logSecurityEvent("otp_email_rate_limit_exceeded", email, clientIP, false, userAgent, { type })
      return NextResponse.json({ error: emailRateLimitCheck.message }, { status: 429 })
    }

    // Verify Turnstile token for registration
    if (type === "registration" && turnstileToken) {
      const turnstileValid = await verifyTurnstileToken(turnstileToken, clientIP)
      if (!turnstileValid) {
        await logSecurityEvent("otp_turnstile_verification_failed", email, clientIP, false, userAgent)
        return NextResponse.json({ error: "Security verification failed. Please try again." }, { status: 400 })
      }

      // Additional validation for registration with name fields
      if (firstName && lastName) {
        const validation = validateSignupInput({
          firstName,
          lastName,
          email,
          password: "temp_password_123", // Dummy values for first-stage validation
          confirmPassword: "temp_password_123",
        })
        if (!validation.valid) {
          await logSecurityEvent("otp_registration_validation_failed", email, clientIP, false, userAgent, {
            errors: validation.errors,
          })
          return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
        }
      }
    }

    // For registration, check if user doesn't exist
    if (type === "registration") {
      const [existingUser] = await sql`
        SELECT id FROM users WHERE email = ${email}
      `
      if (existingUser) {
        await logSecurityEvent("otp_registration_duplicate", email, clientIP, false, userAgent)
        return NextResponse.json({ error: "User with this email already exists" }, { status: 400 })
      }
    }

    // For login, check if user exists
    if (type === "login") {
      const [user] = await sql`
        SELECT first_name FROM users WHERE email = ${email} AND is_active = true
      `
      if (!user) {
        // Return generic message to prevent email enumeration
        await logSecurityEvent("otp_login_user_not_found", email, clientIP, false, userAgent)
        return NextResponse.json({
          success: true,
          message: "If an account with this email exists, an OTP has been sent.",
        })
      }
    }

    // For password reset, check if user exists
    if (type === "password_reset") {
      const [user] = await sql`
        SELECT first_name FROM users WHERE email = ${email} AND is_active = true
      `
      if (!user) {
        // Return generic message to prevent email enumeration
        await logSecurityEvent("otp_password_reset_user_not_found", email, clientIP, false, userAgent)
        return NextResponse.json({
          success: true,
          message: "If an account with this email exists, a reset code has been sent.",
        })
      }
    }

    // Create and send OTP
    const otpCode = await createOTP(email, type)

    // Get user name if exists
    const [user] = await sql`
      SELECT first_name FROM users WHERE email = ${email}
    `

    await sendOTPEmail(email, otpCode, type, user?.first_name)

    // Log successful OTP send
    await logSecurityEvent("otp_sent_success", email, clientIP, true, userAgent, { type })

    return NextResponse.json({
      success: true,
      message: "OTP sent successfully to your email",
    })
  } catch (error) {
    console.error("Send OTP error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 })
  }
}
