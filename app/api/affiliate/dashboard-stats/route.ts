import { neon } from "@neondatabase/serverless"
import { cookies } from "next/headers"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("[v0] Affiliate dashboard stats API called")

    const cookieStore = await cookies()
    const userId = cookieStore.get("user_id")?.value
    console.log("[v0] User ID from cookie:", userId)

    if (!userId) {
      console.log("[v0] No user ID found in cookies")
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get affiliate ID
    console.log("[v0] Fetching affiliate ID for user:", userId)
    const affiliateQuery = await sql`SELECT id FROM affiliates WHERE user_id = ${userId}`
    console.log("[v0] Affiliate query result:", affiliateQuery)

    if (!affiliateQuery.length) {
      console.log("[v0] No affiliate found for user:", userId)
      return Response.json({ error: "Affiliate not found" }, { status: 404 })
    }

    const affiliateId = affiliateQuery[0].id
    console.log("[v0] Affiliate ID:", affiliateId)

    // Get link stats
    console.log("[v0] Fetching link stats for affiliate:", affiliateId)
    const linkStatsQuery = await sql`
      SELECT 
        SUM(clicks) as total_clicks,
        SUM(conversions) as total_conversions
      FROM affiliate_links
      WHERE affiliate_id = ${affiliateId}
    `
    console.log("[v0] Link stats:", linkStatsQuery[0])

    // Get commission stats
    console.log("[v0] Fetching commission stats for affiliate:", affiliateId)
    const commissionStatsQuery = await sql`
      SELECT 
        SUM(affiliate_commission) as total_commissions,
        SUM(CASE WHEN payment_status = 'pending' THEN affiliate_commission ELSE 0 END) as pending_commissions
      FROM transactions
      WHERE affiliate_id = ${affiliateId}
    `
    console.log("[v0] Commission stats:", commissionStatsQuery[0])

    // Get approved products count
    console.log("[v0] Fetching approved products count for affiliate:", affiliateId)
    const productsCountQuery = await sql`
      SELECT COUNT(*) as approved_products
      FROM affiliate_links
      WHERE affiliate_id = ${affiliateId}
    `
    console.log("[v0] Products count:", productsCountQuery[0])

    // Get monthly performance
    console.log("[v0] Fetching monthly performance for affiliate:", affiliateId)
    const monthlyPerformanceQuery = await sql`
      SELECT 
        DATE_TRUNC('month', t.created_at) as month,
        SUM(al.clicks) as clicks,
        SUM(al.conversions) as conversions,
        SUM(t.affiliate_commission) as commissions
      FROM affiliate_links al
      LEFT JOIN transactions t ON al.id = t.tracking_code
      WHERE al.affiliate_id = ${affiliateId} AND al.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', t.created_at)
      ORDER BY month ASC
    `
    console.log("[v0] Monthly performance data points:", monthlyPerformanceQuery.length)

    // Get top products
    console.log("[v0] Fetching top products for affiliate:", affiliateId)
    const topProductsQuery = await sql`
      SELECT 
        p.title,
        al.clicks,
        al.conversions,
        ROUND((al.conversions::float / NULLIF(al.clicks, 0) * 100)::numeric, 2) as conversion_rate
      FROM affiliate_links al
      JOIN products p ON al.product_id = p.id
      WHERE al.affiliate_id = ${affiliateId}
      ORDER BY al.conversions DESC
      LIMIT 5
    `
    console.log("[v0] Top products count:", topProductsQuery.length)

    const clicks = linkStatsQuery[0]?.total_clicks || 0
    const conversions = linkStatsQuery[0]?.total_conversions || 0
    const conversionRate = clicks > 0 ? ((conversions / clicks) * 100).toFixed(2) : "0.00"

    const response = {
      clicks,
      conversions,
      conversionRate: Number.parseFloat(conversionRate),
      totalCommissions: Number(commissionStatsQuery[0]?.total_commissions || 0) / 100,
      pendingCommissions: Number(commissionStatsQuery[0]?.pending_commissions || 0) / 100,
      approvedProducts: productsCountQuery[0]?.approved_products || 0,
      monthlyPerformance: monthlyPerformanceQuery.map((row) => ({
        month: new Date(row.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        clicks: row.clicks || 0,
        conversions: row.conversions || 0,
        commissions: Number(row.commissions || 0) / 100,
      })),
      topProducts: topProductsQuery.map((row) => ({
        name: row.title,
        clicks: row.clicks,
        conversions: row.conversions,
        conversionRate: row.conversion_rate || 0,
      })),
    }

    console.log("[v0] Affiliate dashboard stats response prepared successfully")
    return Response.json(response)
  } catch (error) {
    console.error("[v0] Affiliate dashboard stats error:", error)
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
