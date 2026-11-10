import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userResult = await sql`
      SELECT 
        id,
        email,
        first_name,
        last_name,
        role,
        onboarding_completed,
        profile_picture_url,
        alphanumeric_id
      FROM users 
      WHERE id = ${session.userId}
    `

    if (!userResult || userResult.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const user = userResult[0]

    return NextResponse.json({
      user: {
        id: user.id,
        alphanumericId: user.alphanumeric_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        onboardingCompleted: user.onboarding_completed,
        profilePictureUrl: user.profile_picture_url,
      },
    })
  } catch (error) {
    console.error("Get user session error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
