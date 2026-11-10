import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const products = await sql`
      SELECT 
        p.*,
        v.user_id as vendor_user_id,
        u.first_name as vendor_first_name,
        u.last_name as vendor_last_name,
        u.company_name as vendor_company,
        CONCAT(u.first_name, ' ', u.last_name) as vendor_name
      FROM products p
      JOIN vendors v ON p.vendor_id = v.id
      JOIN users u ON v.user_id = u.id
      ORDER BY p.created_at DESC
    `

    return NextResponse.json({ products })
  } catch (error) {
    console.error("Get admin products error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
