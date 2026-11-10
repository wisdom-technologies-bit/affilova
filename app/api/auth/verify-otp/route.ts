import { type NextRequest, NextResponse } from "next/server"
import { verifyOTP } from "@/lib/otp"
import { z } from "zod"

const verifyOTPSchema = z.object({
  email: z.string().email(),
  otpCode: z.string().length(6),
  type: z.enum(["registration", "login", "password_reset"]),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, otpCode, type } = verifyOTPSchema.parse(body)

    const verification = await verifyOTP(email, otpCode, type)

    if (!verification.valid) {
      return NextResponse.json({ error: verification.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: "OTP verified successfully",
    })
  } catch (error) {
    console.error("Verify OTP error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    return NextResponse.json({ error: "OTP verification failed" }, { status: 500 })
  }
}
