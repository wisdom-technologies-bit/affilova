import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"
import { generateId } from "@/lib/utils"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("Affiliate withdrawals GET API called")

    const user = await verifyAuth()
    if (!user || user.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Fetching withdrawals for affiliate:", user.id)

    const withdrawals = await sql`
      SELECT 
        wr.alphanumeric_id as id,
        wr.amount,
        wr.status,
        wr.requested_at,
        wr.processed_at,
        uba.bank_name,
        uba.account_number,
        uba.account_name,
        wr.admin_notes as rejection_reason
      FROM withdrawal_requests wr
      LEFT JOIN user_bank_accounts uba ON wr.bank_account_id = uba.id
      WHERE wr.user_id = ${user.id}
      ORDER BY wr.requested_at DESC
    `

    console.log("Withdrawals fetched:", withdrawals.length)

    return NextResponse.json({ withdrawals })
  } catch (error) {
    console.error("Affiliate withdrawals GET error:", error)
    return NextResponse.json({ error: "Failed to fetch withdrawals" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("Affiliate withdrawals POST API called")

    const user = await verifyAuth()
    if (!user || user.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { amount, bankAccountId } = await request.json()

    if (!amount || amount < 1000) {
      return NextResponse.json({ error: "Minimum withdrawal amount is ₦1,000" }, { status: 400 })
    }

    console.log("Processing withdrawal request for affiliate:", user.id, "amount:", amount)

    // Check available balance
    const balanceResult = await sql`
      SELECT 
        COALESCE(SUM(CASE WHEN t.payment_status = 'completed' THEN t.affiliate_commission ELSE 0 END), 0) as total_earned,
        COALESCE(SUM(CASE WHEN wr.status IN ('pending', 'approved') THEN wr.amount ELSE 0 END), 0) as pending_withdrawals
      FROM transactions t
      LEFT JOIN withdrawal_requests wr ON wr.user_id = ${user.id}
      WHERE t.affiliate_id = ${user.id}
    `

    const totalEarned = Number.parseFloat(balanceResult[0]?.total_earned || 0)
    const pendingWithdrawals = Number.parseFloat(balanceResult[0]?.pending_withdrawals || 0)
    const availableBalance = totalEarned - pendingWithdrawals

    if (amount > availableBalance) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 })
    }

    if (!bankAccountId) {
      return NextResponse.json({ error: "Please select a bank account" }, { status: 400 })
    }

    const [bankAccount] = await sql`
      SELECT id, bank_name, account_number, account_name, bank_code
      FROM user_bank_accounts 
      WHERE id = ${bankAccountId} AND user_id = ${user.id}
    `

    if (!bankAccount) {
      return NextResponse.json({ error: "Invalid bank account selected" }, { status: 400 })
    }

    // Create withdrawal request
    const withdrawalId = generateId()
    await sql`
      INSERT INTO withdrawal_requests (
        alphanumeric_id, user_id, amount, status, requested_at, bank_account_id
      ) VALUES (
        ${withdrawalId}, ${user.id}, ${amount}, 'pending', NOW(), ${bankAccountId}
      )
    `

    console.log("Withdrawal request created:", withdrawalId)

    return NextResponse.json({
      message: "Withdrawal request submitted successfully",
      withdrawalId,
    })
  } catch (error) {
    console.error("Affiliate withdrawals POST error:", error)
    return NextResponse.json({ error: "Failed to create withdrawal request" }, { status: 500 })
  }
}
