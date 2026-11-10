import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { hashPassword, createToken, setAuthCookie } from "@/lib/auth"
import { generateAlphanumericId } from "@/lib/utils"
import {
  getClientIP,
  validateSignupInput,
  sanitizeUserData,
  logSecurityEvent,
  isHoneypotEmpty,
} from "@/lib/security"
import { z } from "zod"

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  website_url: z.string().optional(), // Honeypot field
})

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request)
  const userAgent = request.headers.get("user-agent") || "unknown"

  try {
    const body = await request.json()
    const validatedData = registerSchema.parse(body)

    // Check honeypot field - reject if not empty
    if (!isHoneypotEmpty(validatedData.website_url)) {
      console.log("[Security] Honeypot triggered in registration")
      await logSecurityEvent("registration_honeypot_triggered", validatedData.email, clientIP, false, userAgent, {
        honeypot: validatedData.website_url,
      })
      // Don't reveal that honeypot was triggered - return generic success
      return NextResponse.json(
        {
          user: { id: "", alphanumericId: "", email: "", role: "user" },
          redirectUrl: "/dashboard/select-role",
        },
        { status: 200 },
      )
    }

    // Comprehensive input validation
    const validation = validateSignupInput({
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      email: validatedData.email,
      password: validatedData.password,
      confirmPassword: validatedData.password, // Confirmed during form submission
      phone: validatedData.phone,
      websiteUrl: validatedData.website_url,
    })

    if (!validation.valid) {
      await logSecurityEvent("registration_validation_failed", validatedData.email, clientIP, false, userAgent, {
        errors: validation.errors,
      })
      return NextResponse.json({ error: "Invalid input data", details: validation.errors }, { status: 400 })
    }

    // Check if user already exists
    const existingUser = await sql`
      SELECT id FROM users WHERE email = ${validatedData.email}
    `

    if (existingUser.length > 0) {
      await logSecurityEvent("registration_duplicate_email", validatedData.email, clientIP, false, userAgent)
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 })
    }

    // Sanitize user data before storing
    const sanitizedData = sanitizeUserData({
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      email: validatedData.email,
      phone: validatedData.phone,
    })

    // Hash password
    const passwordHash = await hashPassword(validatedData.password)

    // Generate unique alphanumeric ID
    let alphanumericId = generateAlphanumericId()
    let attempts = 0

    while (attempts < 10) {
      const existingId = await sql`
        SELECT alphanumeric_id FROM users WHERE alphanumeric_id = ${alphanumericId}
      `
      if (existingId.length === 0) break
      alphanumericId = generateAlphanumericId()
      attempts++
    }

    if (attempts >= 10) {
      await logSecurityEvent("registration_id_generation_failed", validatedData.email, clientIP, false, userAgent)
      return NextResponse.json({ error: "Unable to generate unique ID. Please try again." }, { status: 500 })
    }

    const [user] = await sql`
      INSERT INTO users (
        alphanumeric_id, email, password_hash, first_name, last_name, 
        phone, role, is_verified, has_password, onboarding_completed
      )
      VALUES (
        ${alphanumericId}, ${sanitizedData.email}, ${passwordHash},
        ${sanitizedData.firstName}, ${sanitizedData.lastName},
        ${sanitizedData.phone || null}, 'user', false, true, false
      )
      RETURNING id, alphanumeric_id, email, role, first_name, last_name, phone, is_verified, is_active
    `

    // Log successful registration
    await logSecurityEvent("registration_success", validatedData.email, clientIP, true, userAgent, {
      userId: user.id,
    })

    // Create JWT token
    const token = await createToken({
      userId: user.id,
      alphanumericId: user.alphanumeric_id,
      email: user.email,
      role: user.role,
    })

    await setAuthCookie(token)

    return NextResponse.json({
      user: {
        id: user.id,
        alphanumericId: user.alphanumeric_id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        isVerified: user.is_verified,
        isActive: user.is_active,
      },
      redirectUrl: "/dashboard/select-role",
    })
  } catch (error) {
    console.error("Registration error:", error)

    if (error instanceof z.ZodError) {
      await logSecurityEvent("registration_zod_validation_failed", null, clientIP, false, userAgent, {
        errors: error.errors,
      })
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
