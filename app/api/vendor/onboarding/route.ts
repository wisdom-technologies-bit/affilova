import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { brevoService } from "@/lib/brevo"
import { z } from "zod"

const onboardingSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
  businessType: z.string().min(1),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  description: z.string().min(1),
  profilePictureUrl: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = onboardingSchema.parse(body)

    // Update user data
    await sql`
      UPDATE users 
      SET first_name = ${validatedData.firstName},
          last_name = ${validatedData.lastName},
          company_name = ${validatedData.companyName},
          profile_picture_url = ${validatedData.profilePictureUrl || null},
          onboarding_completed = true
      WHERE id = ${session.userId}
    `

    // Update vendor data
    await sql`
      UPDATE vendors 
      SET business_type = ${validatedData.businessType},
          website_url = ${validatedData.websiteUrl || null},
          description = ${validatedData.description}
      WHERE user_id = ${session.userId}
    `

    // Get user email for welcome email
    const [user] = await sql`
      SELECT email, first_name FROM users WHERE id = ${session.userId}
    `

    // Send welcome email now that onboarding is complete
    if (user) {
      await brevoService.sendWelcomeEmail(user.email, user.first_name, "vendor")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Vendor onboarding error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
