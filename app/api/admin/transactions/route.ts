import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const transactions = await sql`
      SELECT 
        t.*,
        p.title as product_title,
        COALESCE(vu.first_name || ' ' || vu.last_name, vu.company_name) as vendor_name,
        COALESCE(au.first_name || ' ' || au.last_name, au.company_name) as affiliate_name
      FROM transactions t
      LEFT JOIN products p ON t.product_id = p.id
      LEFT JOIN vendors v ON t.vendor_id = v.id
      LEFT JOIN users vu ON v.user_id = vu.id
      LEFT JOIN affiliates a ON t.affiliate_id = a.id
      LEFT JOIN users au ON a.user_id = au.id
      ORDER BY t.created_at DESC
    `

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error("Get admin transactions error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
