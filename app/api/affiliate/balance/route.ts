import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("Affiliate balance API called")

    const user = await verifyAuth()
    if (!user || user.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Fetching balance for affiliate:", user.id)

    // Get total earnings and pending withdrawals
    const balanceResult = await sql`
      SELECT 
        COALESCE(SUM(CASE WHEN t.payment_status = 'completed' THEN t.affiliate_commission ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN wr.status IN ('pending', 'approved') THEN wr.amount ELSE 0 END), 0) as pending_withdrawals,
        COALESCE(SUM(CASE WHEN wr.status = 'completed' THEN wr.amount ELSE 0 END), 0) as completed_withdrawals
      FROM transactions t
      LEFT JOIN withdrawal_requests wr ON wr.user_id = ${user.id}
      WHERE t.affiliate_id = ${user.id}
    `

    const result = balanceResult[0]
    const totalEarned = Number.parseFloat(result?.total_earned || 0)
    const pendingWithdrawals = Number.parseFloat(result?.pending_withdrawals || 0)
    const completedWithdrawals = Number.parseFloat(result?.completed_withdrawals || 0)
    const availableBalance = totalEarned - pendingWithdrawals - completedWithdrawals

    const balance = {
      available: Math.max(0, availableBalance),
      pending: pendingWithdrawals,
      total_earned: totalEarned,
    }

    console.log("Balance calculated:", balance)

    return NextResponse.json({ balance })
  } catch (error) {
    console.error("Affiliate balance error:", error)
    return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 })
  }
}
