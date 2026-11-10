import { sql } from "@/lib/db"
import { type NextRequest } from "next/server"

/**
 * Extract client IP address from request headers
 */
export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const ip = forwarded ? forwarded.split(",")[0].trim() : request.headers.get("x-real-ip") || "unknown"
  return ip
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email) && email.length <= 254
}

/**
 * Validate name field - block malicious patterns
 * Blocks: 'http', 'www', '.ly' (and any URL patterns)
 */
export function isValidName(name: string): boolean {
  if (!name || name.trim().length === 0) return false
  if (name.length > 100) return false

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /http/i,
    /www\./i,
    /\.ly\b/i,
    /\.(com|net|org|info|biz|co|tk|ml|ga)\b/i, // TLDs often used in spam
    /<script/i,
    /javascript:/i,
    /onerror=/i,
    /onclick=/i,
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(name)) return false
  }

  return true
}

/**
 * Sanitize user input to remove HTML/script tags
 * Simple regex-based approach (no external dependencies to avoid ESM issues)
 */
export function sanitizeInput(input: string): string {
  if (!input) return ""

  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, "")

  // Remove script tags and content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")

  // Remove event handlers
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, "")

  // Remove dangerous characters
  sanitized = sanitized.replace(/[<>]/g, "")

  // Normalize whitespace
  sanitized = sanitized.trim().replace(/\s+/g, " ")

  return sanitized
}

/**
 * Check OTP rate limit (email-based, 3 requests per 15 minutes)
 */
export async function checkOTPRateLimit(email: string, ip: string): Promise<{ allowed: boolean; message?: string }> {
  try {
    // Clean up expired records
    await sql`
      DELETE FROM otp_rate_limits 
      WHERE expires_at < NOW()
    `

    // Check if email+IP combination has exceeded limit
    const [existing] = await sql`
      SELECT request_count, expires_at
      FROM otp_rate_limits
      WHERE email = ${email} AND ip_address = ${ip} AND expires_at > NOW()
      LIMIT 1
    `

    if (existing) {
      if (existing.request_count >= 3) {
        return {
          allowed: false,
          message: "Too many OTP requests. Please try again in 15 minutes.",
        }
      }

      // Increment count
      await sql`
        UPDATE otp_rate_limits
        SET request_count = request_count + 1, last_request_at = NOW()
        WHERE email = ${email} AND ip_address = ${ip}
      `
    } else {
      // Create new rate limit record
      await sql`
        INSERT INTO otp_rate_limits (email, ip_address, request_count, created_at, expires_at)
        VALUES (${email}, ${ip}, 1, NOW(), NOW() + interval '15 minutes')
      `
    }

    return { allowed: true }
  } catch (error) {
    console.error("[Security] OTP rate limit check error:", error)
    // On error, allow the request but log it
    return { allowed: true }
  }
}

/**
 * Check IP-based rate limit (5 requests per 10 minutes per endpoint)
 */
export async function checkIPRateLimit(
  ip: string,
  requestType: string,
  maxRequests: number = 5,
): Promise<{ allowed: boolean; message?: string }> {
  try {
    // Clean up expired records
    await sql`
      DELETE FROM ip_rate_limits 
      WHERE expires_at < NOW()
    `

    // Check if IP has exceeded limit for this request type
    const [existing] = await sql`
      SELECT request_count
      FROM ip_rate_limits
      WHERE ip_address = ${ip} AND request_type = ${requestType} AND expires_at > NOW()
      LIMIT 1
    `

    if (existing) {
      if (existing.request_count >= maxRequests) {
        return {
          allowed: false,
          message: `Too many requests. Please try again later.`,
        }
      }

      // Increment count
      await sql`
        UPDATE ip_rate_limits
        SET request_count = request_count + 1, last_request_at = NOW()
        WHERE ip_address = ${ip} AND request_type = ${requestType}
      `
    } else {
      // Create new rate limit record
      await sql`
        INSERT INTO ip_rate_limits (ip_address, request_type, request_count, created_at, expires_at)
        VALUES (${ip}, ${requestType}, 1, NOW(), NOW() + interval '10 minutes')
      `
    }

    return { allowed: true }
  } catch (error) {
    console.error("[Security] IP rate limit check error:", error)
    return { allowed: true }
  }
}

/**
 * Log security events for audit trail
 */
export async function logSecurityEvent(
  eventType: string,
  email: string | null,
  ip: string,
  success: boolean,
  userAgent?: string,
  details?: Record<string, any>,
) {
  try {
    await sql`
      INSERT INTO security_audit_log (event_type, email, ip_address, user_agent, details, success)
      VALUES (${eventType}, ${email || null}, ${ip}, ${userAgent || null}, ${JSON.stringify(details || {})}, ${success})
    `
  } catch (error) {
    console.error("[Security] Audit log error:", error)
  }
}

/**
 * Verify Cloudflare Turnstile token
 * Uses the correct v0 API endpoint: https://challenges.cloudflare.com/turnstile/v0/validate
 */
export async function verifyTurnstileToken(token: string, remoteIP?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY

  if (!secret) {
    console.error("[Security] TURNSTILE_SECRET_KEY not configured")
    return false
  }

  if (!token || token.trim() === "") {
    console.error("[Security] Turnstile token is empty")
    return false
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: remoteIP,
      }),
    })

    // Check if response is OK (2xx status)
    if (!response.ok) {
      console.error(
        `[Security] Turnstile API error: ${response.status} ${response.statusText}`,
      )
      return false
    }

    // Check if response has content
    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      console.error("[Security] Turnstile API returned non-JSON response")
      return false
    }

    const data = await response.json()
    return data.success === true
  } catch (error) {
    console.error("[Security] Turnstile verification error:", error)
    return false
  }
}

/**
 * Check honeypot field - should always be empty
 */
export function isHoneypotEmpty(honeypotValue?: string): boolean {
  return !honeypotValue || honeypotValue.trim() === ""
}

/**
 * Comprehensive input validation for signup
 */
export function validateSignupInput(data: {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  phone?: string
  websiteUrl?: string
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  // Check honeypot
  if (!isHoneypotEmpty(data.websiteUrl)) {
    return { valid: false, errors: { honeypot: "Invalid submission" } }
  }

  // Validate names
  if (!isValidName(data.firstName)) {
    errors.firstName = "Invalid first name. Avoid URLs or suspicious content."
  }
  if (!isValidName(data.lastName)) {
    errors.lastName = "Invalid last name. Avoid URLs or suspicious content."
  }

  // Validate email
  if (!isValidEmail(data.email)) {
    errors.email = "Invalid email address"
  }

  // Validate password
  if (data.password.length < 8) {
    errors.password = "Password must be at least 8 characters"
  }
  if (data.password !== data.confirmPassword) {
    errors.confirmPassword = "Passwords do not match"
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Comprehensive input validation for login
 */
export function validateLoginInput(data: { email: string; password: string }): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (!isValidEmail(data.email)) {
    errors.email = "Invalid email address"
  }

  if (!data.password || data.password.length === 0) {
    errors.password = "Password is required"
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

/**
 * Sanitize sensitive data before sending to external services
 */
export function sanitizeUserData(data: {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
}): Record<string, string> {
  return {
    firstName: data.firstName ? sanitizeInput(data.firstName) : "",
    lastName: data.lastName ? sanitizeInput(data.lastName) : "",
    email: data.email || "",
    phone: data.phone ? sanitizeInput(data.phone) : "",
  }
}
