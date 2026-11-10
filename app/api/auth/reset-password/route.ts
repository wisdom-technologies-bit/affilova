import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { validateResetToken, markTokenAsUsed } from "@/lib/password-reset"
import { hashPassword } from "@/lib/auth"
import { brevoService } from "@/lib/brevo"
import { z } from "zod"

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password } = resetPasswordSchema.parse(body)

    // Validate token
    const tokenValidation = await validateResetToken(token)

    if (!tokenValidation.valid || !tokenValidation.userAlphanumericId) {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 })
    }

    // Get user details
    const [user] = await sql`
      SELECT id, email, first_name, is_active
      FROM users 
      WHERE alphanumeric_id = ${tokenValidation.userAlphanumericId}
    `

    if (!user || !user.is_active) {
      return NextResponse.json({ error: "User not found or inactive" }, { status: 404 })
    }

    // Hash new password
    const passwordHash = await hashPassword(password)

    // Update password and mark as having password
    await sql`
      UPDATE users 
      SET password_hash = ${passwordHash}, has_password = true
      WHERE alphanumeric_id = ${tokenValidation.userAlphanumericId}
    `

    // Mark token as used
    await markTokenAsUsed(token)

    // Send confirmation email
    await brevoService.sendPasswordResetConfirmationEmail(user.email, user.first_name)

    return NextResponse.json({
      success: true,
      message: "Password reset successfully",
    })
  } catch (error) {
    console.error("Reset password error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
