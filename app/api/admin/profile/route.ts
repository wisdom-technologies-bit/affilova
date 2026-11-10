import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { z } from "zod"

const updateProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  profilePicture: z.string().url().optional(),
})

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const users = await sql`
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        company_name,
        profile_picture,
        created_at
      FROM users 
      WHERE id = ${session.userId}
    `

    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ user: users[0] })
  } catch (error) {
    console.error("Get admin profile error:", error)
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
    const validatedData = updateProfileSchema.parse(body)

    await sql`
      UPDATE users 
      SET 
        first_name = ${validatedData.firstName},
        last_name = ${validatedData.lastName},
        phone = ${validatedData.phone || null},
        company_name = ${validatedData.companyName || null},
        profile_picture = ${validatedData.profilePicture || null},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${session.userId}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update admin profile error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid profile data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
