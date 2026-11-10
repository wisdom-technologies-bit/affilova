import { sql } from "@/lib/db"
import { brevoService } from "@/lib/brevo"

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function createOTP(email: string, type: "registration" | "login" | "password_reset"): Promise<string> {
  const otpCode = generateOTP()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now

  // Invalidate any existing OTPs for this email and type
  await sql`
    UPDATE otp_verifications 
    SET verified = true 
    WHERE email = ${email} AND otp_type = ${type} AND verified = false
  `

  // Create new OTP
  await sql`
    INSERT INTO otp_verifications (email, otp_code, otp_type, expires_at)
    VALUES (${email}, ${otpCode}, ${type}, ${expiresAt})
  `

  return otpCode
}

export async function verifyOTP(
  email: string,
  otpCode: string,
  type: "registration" | "login" | "password_reset",
): Promise<{ valid: boolean; message?: string }> {
  // Get the latest OTP for this email and type
  const [otp] = await sql`
    SELECT id, otp_code, expires_at, verified, attempts
    FROM otp_verifications
    WHERE email = ${email} AND otp_type = ${type} AND verified = false
    ORDER BY created_at DESC
    LIMIT 1
  `

  if (!otp) {
    return { valid: false, message: "No OTP found. Please request a new one." }
  }

  if (otp.verified) {
    return { valid: false, message: "OTP has already been used." }
  }

  if (new Date() > new Date(otp.expires_at)) {
    return { valid: false, message: "OTP has expired. Please request a new one." }
  }

  if (otp.attempts >= 3) {
    return { valid: false, message: "Too many failed attempts. Please request a new OTP." }
  }

  if (otp.otp_code !== otpCode) {
    // Increment attempts
    await sql`
      UPDATE otp_verifications 
      SET attempts = attempts + 1 
      WHERE id = ${otp.id}
    `
    return { valid: false, message: "Invalid OTP code." }
  }

  // Mark OTP as verified
  await sql`
    UPDATE otp_verifications 
    SET verified = true 
    WHERE id = ${otp.id}
  `

  return { valid: true }
}

export async function sendOTPEmail(
  email: string,
  otpCode: string,
  type: "registration" | "login" | "password_reset",
  userName?: string,
) {
  const typeMessages = {
    registration: {
      subject: "Verify Your Affilova Registration",
      title: "Complete Your Registration",
      message: "Please use this OTP to complete your registration:",
    },
    login: {
      subject: "Your Affilova Login Code",
      title: "Secure Login Verification",
      message: "Please use this OTP to complete your login:",
    },
    password_reset: {
      subject: "Reset Your Affilova Password",
      title: "Password Reset Verification",
      message: "Please use this OTP to reset your password:",
    },
  }

  const config = typeMessages[type]

  return brevoService.sendEmail({
    to: [{ email, name: userName || "User" }],
    subject: config.subject,
    htmlContent: `
      <h1 style="color: #22c55e; margin-bottom: 20px;">${config.title}</h1>
      <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName || "there"},</p>
      <p style="font-size: 16px; line-height: 1.6; color: #374151;">${config.message}</p>
      <div style="text-align: center; margin: 40px 0;">
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; display: inline-block;">
          <h2 style="font-size: 32px; font-weight: bold; color: #22c55e; margin: 0; letter-spacing: 4px;">${otpCode}</h2>
        </div>
      </div>
      <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; font-size: 14px; color: #92400e;">
          <strong>Security Note:</strong> This OTP will expire in 10 minutes. Never share this code with anyone.
        </p>
      </div>
      <p style="font-size: 14px; line-height: 1.6; color: #6b7280;">
        If you didn't request this verification, please ignore this email or contact our support team.
      </p>
    `,
  })
}
