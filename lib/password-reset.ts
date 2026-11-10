import { sql } from "@/lib/db"
import crypto from "crypto"

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex")
}

export async function createPasswordResetToken(userAlphanumericId: string): Promise<string> {
  const token = generateResetToken()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now

  // Invalidate any existing tokens for this user
  await sql`
    UPDATE password_reset_tokens 
    SET used = true 
    WHERE user_id = ${userAlphanumericId} AND used = false
  `

  // Create new token
  await sql`
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (${userAlphanumericId}, ${token}, ${expiresAt})
  `

  return token
}

export async function validateResetToken(token: string): Promise<{ valid: boolean; userAlphanumericId?: string }> {
  const [resetToken] = await sql`
    SELECT user_id, expires_at, used
    FROM password_reset_tokens
    WHERE token = ${token}
  `

  if (!resetToken) {
    return { valid: false }
  }

  if (resetToken.used) {
    return { valid: false }
  }

  if (new Date() > new Date(resetToken.expires_at)) {
    return { valid: false }
  }

  return { valid: true, userAlphanumericId: resetToken.user_id }
}

export async function markTokenAsUsed(token: string): Promise<void> {
  await sql`
    UPDATE password_reset_tokens 
    SET used = true 
    WHERE token = ${token}
  `
}
