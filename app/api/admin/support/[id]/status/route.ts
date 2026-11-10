import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { z } from "zod"

const updateStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "closed"]),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const ticketId = params.id
    const body = await request.json()
    const { status } = updateStatusSchema.parse(body)

    await sql`
      UPDATE support_tickets 
      SET status = ${status}, updated_at = CURRENT_TIMESTAMP
      WHERE alphanumeric_id = ${ticketId}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update ticket status error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
