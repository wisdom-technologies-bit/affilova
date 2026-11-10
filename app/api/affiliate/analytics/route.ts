import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest) {
  try {
    console.log("Affiliate analytics API called")

    const user = await verifyAuth()
    if (!user || user.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Number.parseInt(searchParams.get("days") || "30")

    console.log("Fetching analytics for affiliate:", user.id, "for", days, "days")

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get total earnings
    const earningsResult = await sql`
      SELECT COALESCE(SUM(commission_amount), 0) as total_earnings
      FROM transactions 
      WHERE affiliate_id = ${user.id} 
      AND status = 'completed'
      AND created_at >= ${startDate.toISOString()}
      AND created_at <= ${endDate.toISOString()}
    `

    // Get total clicks
    const clicksResult = await sql`
      SELECT COUNT(*) as total_clicks
      FROM affiliate_clicks 
      WHERE affiliate_id = ${user.id}
      AND created_at >= ${startDate.toISOString()}
      AND created_at <= ${endDate.toISOString()}
    `

    // Get total conversions
    const conversionsResult = await sql`
      SELECT COUNT(*) as total_conversions
      FROM transactions 
      WHERE affiliate_id = ${user.id}
      AND status = 'completed'
      AND created_at >= ${startDate.toISOString()}
      AND created_at <= ${endDate.toISOString()}
    `

    // Get top performing products
    const topProductsResult = await sql`
      SELECT 
        p.alphanumeric_id as id,
        p.title,
        COALESCE(SUM(t.commission_amount), 0) as earnings,
        COUNT(DISTINCT ac.id) as clicks,
        COUNT(DISTINCT t.id) as conversions
      FROM products p
      LEFT JOIN transactions t ON p.id = t.product_id AND t.affiliate_id = ${user.id} AND t.status = 'completed'
      LEFT JOIN affiliate_clicks ac ON p.id = ac.product_id AND ac.affiliate_id = ${user.id}
      WHERE (t.created_at >= ${startDate.toISOString()} OR ac.created_at >= ${startDate.toISOString()})
      AND (t.created_at <= ${endDate.toISOString()} OR ac.created_at <= ${endDate.toISOString()})
      GROUP BY p.id, p.alphanumeric_id, p.title
      HAVING COUNT(DISTINCT ac.id) > 0 OR COUNT(DISTINCT t.id) > 0
      ORDER BY earnings DESC
      LIMIT 5
    `

    // Get recent activity
    const recentActivityResult = await sql`
      SELECT 
        t.alphanumeric_id as id,
        'commission' as type,
        CONCAT('Earned commission from ', p.title) as description,
        t.commission_amount as amount,
        t.created_at as date
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      WHERE t.affiliate_id = ${user.id}
      AND t.status = 'completed'
      ORDER BY t.created_at DESC
      LIMIT 10
    `

    const totalEarnings = Number.parseFloat(earningsResult[0]?.total_earnings || 0)
    const totalClicks = Number.parseInt(clicksResult[0]?.total_clicks || 0)
    const totalConversions = Number.parseInt(conversionsResult[0]?.total_conversions || 0)
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

    const analytics = {
      totalEarnings,
      totalClicks,
      totalConversions,
      conversionRate,
      topProducts: topProductsResult.map((product) => ({
        id: product.id,
        title: product.title,
        earnings: Number.parseFloat(product.earnings || 0),
        clicks: Number.parseInt(product.clicks || 0),
        conversions: Number.parseInt(product.conversions || 0),
      })),
      recentActivity: recentActivityResult.map((activity) => ({
        id: activity.id,
        type: activity.type,
        description: activity.description,
        amount: Number.parseFloat(activity.amount || 0),
        date: activity.date,
      })),
    }

    console.log("Analytics data prepared:", analytics)

    return NextResponse.json({ analytics })
  } catch (error) {
    console.error("Affiliate analytics error:", error)
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 })
  }
}
