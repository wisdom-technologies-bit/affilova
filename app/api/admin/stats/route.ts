import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get platform stats
    const [userStats] = await sql`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'vendor' THEN 1 END) as total_vendors,
        COUNT(CASE WHEN role = 'affiliate' THEN 1 END) as total_affiliates
      FROM users
      WHERE role IN ('vendor', 'affiliate')
    `

    const [productStats] = await sql`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN is_active = false THEN 1 END) as pending_products
      FROM products
    `

    const [salesStats] = await sql`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(platform_fee), 0) as platform_earnings
      FROM transactions
      WHERE payment_status = 'completed'
    `

    const [withdrawalStats] = await sql`
      SELECT 
        COALESCE(SUM(amount), 0) as pending_withdrawals
      FROM withdrawal_requests
      WHERE status = 'pending'
    `

    return NextResponse.json({
      totalUsers: Number.parseInt(userStats.total_users) || 0,
      totalVendors: Number.parseInt(userStats.total_vendors) || 0,
      totalAffiliates: Number.parseInt(userStats.total_affiliates) || 0,
      totalProducts: Number.parseInt(productStats.total_products) || 0,
      pendingProducts: Number.parseInt(productStats.pending_products) || 0,
      totalSales: Number.parseInt(salesStats.total_sales) || 0,
      platformEarnings: Number.parseInt(salesStats.platform_earnings) || 0,
      pendingWithdrawals: Number.parseInt(withdrawalStats.pending_withdrawals) || 0,
    })
  } catch (error) {
    console.error("Get admin stats error:", error)
    return NextResponse.json({ error: "Failed to fetch admin stats" }, { status: 500 })
  }
}
