import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession, createToken, setAuthCookie } from "@/lib/auth"
import { generateAlphanumericId } from "@/lib/utils"
import { z } from "zod"

const roleSchema = z.object({
  role: z.enum(["vendor", "affiliate"]),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { role } = roleSchema.parse(body)

    // Update user role
    await sql`
      UPDATE users 
      SET role = ${role}
      WHERE id = ${session.userId}
    `

    // Create role-specific record
    if (role === "vendor") {
      const vendorId = generateAlphanumericId()

      // Check if vendor record already exists
      const [existingVendor] = await sql`
        SELECT id FROM vendors WHERE user_id = ${session.userId}
      `

      if (!existingVendor) {
        await sql`
          INSERT INTO vendors (alphanumeric_id, user_id, is_approved)
          VALUES (${vendorId}, ${session.userId}, true)
        `
      }
    } else if (role === "affiliate") {
      const affiliateId = generateAlphanumericId()

      // Check if affiliate record already exists
      const [existingAffiliate] = await sql`
        SELECT id FROM affiliates WHERE user_id = ${session.userId}
      `

      if (!existingAffiliate) {
        await sql`
          INSERT INTO affiliates (alphanumeric_id, user_id, is_approved, registration_fee_paid)
          VALUES (${affiliateId}, ${session.userId}, true, true)
        `
      }
    }

    // Create new JWT token with updated role
    const token = await createToken({
      userId: session.userId,
      alphanumericId: session.alphanumericId,
      email: session.email,
      role: role,
    })

    await setAuthCookie(token)

    return NextResponse.json({ success: true, role })
  } catch (error) {
    console.error("Role selection error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid role data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
