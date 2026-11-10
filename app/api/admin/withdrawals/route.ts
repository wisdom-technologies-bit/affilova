import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const withdrawals = await sql`
      SELECT 
        w.*,
        u.first_name || ' ' || u.last_name as user_name,
        u.email as user_email,
        b.bank_name,
        b.account_number,
        b.account_name
      FROM withdrawal_requests w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN user_bank_accounts b ON w.user_id = b.user_id
      ORDER BY w.created_at DESC
    `

    return NextResponse.json({ withdrawals })
  } catch (error) {
    console.error("Get admin withdrawals error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
