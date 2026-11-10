import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { z } from "zod"

const settingsSchema = z.object({
  platformCommission: z.number().min(0).max(100),
  affiliateRegistrationFee: z.number().min(0),
  payoutDay: z.string(),
  autoPayouts: z.boolean(),
  emailNotifications: z.boolean(),
  maintenanceMode: z.boolean(),
  allowNewRegistrations: z.boolean(),
  requireEmailVerification: z.boolean(),
  minimumWithdrawal: z.number().min(0),
  maxCommissionRate: z.number().min(0).max(100),
})

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Return default settings for now
    const settings = {
      platformCommission: 10,
      affiliateRegistrationFee: 0,
      payoutDay: "thursday",
      autoPayouts: false,
      emailNotifications: true,
      maintenanceMode: false,
      allowNewRegistrations: true,
      requireEmailVerification: true,
      minimumWithdrawal: 5000,
      maxCommissionRate: 50,
    }

    return NextResponse.json({ settings })
  } catch (error) {
    console.error("Get admin settings error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const validatedSettings = settingsSchema.parse(body)

    // In a real implementation, you would save these settings to the database
    // For now, we'll just return success

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update admin settings error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid settings data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
