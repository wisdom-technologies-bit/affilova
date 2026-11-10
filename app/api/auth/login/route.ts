import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { verifyPassword, createToken, setAuthCookie } from "@/lib/auth"
import { brevoService } from "@/lib/brevo"
import {
  getClientIP,
  validateLoginInput,
  checkIPRateLimit,
  logSecurityEvent,
  isHoneypotEmpty,
  verifyTurnstileToken,
} from "@/lib/security"
import { z } from "zod"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
  website_url: z.string().optional(), // Honeypot field
})

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"

  try {
    const body = await request.json()
    const { email, password, turnstileToken, website_url } = loginSchema.parse(body)

    // Check honeypot field - reject if not empty
    if (!isHoneypotEmpty(website_url)) {
      console.log("[Security] Honeypot triggered in login")
      await logSecurityEvent("login_honeypot_triggered", email, clientIP, false, userAgent, {
        honeypot: website_url,
      })
      // Don't reveal that honeypot was triggered - return generic success
      return NextResponse.json({
        user: { id: "", alphanumericId: "", email: "", role: "user" },
        redirectUrl: "/dashboard/select-role",
      })
    }

    // Verify Turnstile token
    if (turnstileToken) {
      const turnstileValid = await verifyTurnstileToken(turnstileToken, clientIP)
      if (!turnstileValid) {
        await logSecurityEvent("login_turnstile_verification_failed", email, clientIP, false, userAgent)
        return NextResponse.json({ error: "Security verification failed. Please try again." }, { status: 400 })
      }
    }

    // Check IP-based rate limiting (5 failed attempts per 10 minutes)
    const ipRateLimitCheck = await checkIPRateLimit(clientIP, "login_attempt", 5)
    if (!ipRateLimitCheck.allowed) {
      await logSecurityEvent("login_ip_rate_limit_exceeded", email, clientIP, false, userAgent)
      return NextResponse.json({ error: ipRateLimitCheck.message }, { status: 429 })
    }

    // Validate login input
    const validation = validateLoginInput({ email, password })
    if (!validation.valid) {
      await logSecurityEvent("login_validation_failed", email, clientIP, false, userAgent, {
        errors: validation.errors,
      })
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    // Find user by email
    const [user] = await sql`
      SELECT id, alphanumeric_id, email, password_hash, role, first_name, last_name, 
             is_verified, is_active, google_id, has_password
      FROM users 
      WHERE email = ${email}
    `

    if (!user) {
      await logSecurityEvent("login_user_not_found", email, clientIP, false, userAgent)
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    // Check if user has a password (not Google-only account)
    if (!user.has_password) {
      await logSecurityEvent("login_google_account", email, clientIP, false, userAgent)
      return NextResponse.json(
        {
          error: "google_account_detected",
          message: "This email is associated with a Google account. Please sign in with Google or reset your password.",
        },
        { status: 401 },
      )
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash)
    if (!isValidPassword) {
      await logSecurityEvent("login_invalid_password", email, clientIP, false, userAgent)
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    // Check if account is active
    if (!user.is_active) {
      await logSecurityEvent("login_account_deactivated", email, clientIP, false, userAgent)
      return NextResponse.json({ error: "Account is deactivated. Please contact support." }, { status: 401 })
    }

    // Send login notification email
    const loginTime = new Date().toLocaleString()
    await brevoService.sendLoginNotificationEmail(user.email, user.first_name, loginTime)

    // Create JWT token
    const token = await createToken({
      userId: user.id,
      alphanumericId: user.alphanumeric_id,
      email: user.email,
      role: user.role,
    })

    await setAuthCookie(token)

    // Log successful login
    await logSecurityEvent("login_success", email, clientIP, true, userAgent, { userId: user.id })

    // Determine redirect URL
    let redirectUrl = "/"
    if (!user.role || user.role === "user") {
      redirectUrl = "/dashboard/select-role"
    } else if (user.role === "admin") {
      redirectUrl = `/dashboard/admin`
    } else {
      redirectUrl = `/dashboard/${user.role}`
    }

    return NextResponse.json({
      user: {
        id: user.id,
        alphanumericId: user.alphanumeric_id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        isVerified: user.is_verified,
        isActive: user.is_active,
      },
      redirectUrl,
    })
  } catch (error) {
    console.error("Login error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
