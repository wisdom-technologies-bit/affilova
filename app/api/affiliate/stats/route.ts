import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get affiliate ID
    const [affiliate] = await sql`
      SELECT id FROM affiliates WHERE user_id = ${session.userId}
    `

    if (!affiliate) {
      return NextResponse.json({ error: "Affiliate profile not found" }, { status: 404 })
    }

    // Get affiliate stats
    const [stats] = await sql`
      SELECT 
        COALESCE(SUM(al.clicks), 0) as total_clicks,
        COALESCE(SUM(al.conversions), 0) as total_conversions,
        COALESCE(SUM(t.affiliate_commission), 0) as total_commissions,
        COALESCE(SUM(CASE WHEN t.payment_status = 'pending' THEN t.affiliate_commission ELSE 0 END), 0) as pending_commissions
      FROM affiliate_links al
      LEFT JOIN transactions t ON al.tracking_code = t.tracking_code
      WHERE al.affiliate_id = ${affiliate.id}
    `

    const [productStats] = await sql`
      SELECT COUNT(*) as approved_products
      FROM affiliate_applications
      WHERE affiliate_id = ${affiliate.id} AND status = 'approved'
    `

    const totalClicks = Number.parseInt(stats.total_clicks) || 0
    const totalConversions = Number.parseInt(stats.total_conversions) || 0

    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

    return NextResponse.json({
      totalClicks,
      totalConversions,
      totalCommissions: Number.parseInt(stats.total_commissions) || 0,
      pendingCommissions: Number.parseInt(stats.pending_commissions) || 0,
      approvedProducts: Number.parseInt(productStats.approved_products) || 0,
      conversionRate, // Now returns calculated conversion rate
    })
  } catch (error) {
    console.error("Get affiliate stats error:", error)
    return NextResponse.json({ error: "Failed to fetch affiliate stats" }, { status: 500 })
  }
}
