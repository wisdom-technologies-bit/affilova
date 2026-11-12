import { neon } from "@neondatabase/serverless"
import { cookies } from "next/headers"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {

    const cookieStore = await cookies()
    const userId = cookieStore.get("user_id")?.value

    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get affiliate ID
    const affiliateQuery = await sql`SELECT id FROM affiliates WHERE user_id = ${userId}`

    if (!affiliateQuery.length) {
      return Response.json({ error: "Affiliate not found" }, { status: 404 })
    }

    const affiliateId = affiliateQuery[0].id

    // Get link stats
    const linkStatsQuery = await sql`
      SELECT 
        SUM(clicks) as total_clicks,
        SUM(conversions) as total_conversions
      FROM affiliate_links
      WHERE affiliate_id = ${affiliateId}
    `

    // Get commission stats
    const commissionStatsQuery = await sql`
      SELECT 
        SUM(affiliate_commission) as total_commissions,
        SUM(CASE WHEN payment_status = 'pending' THEN affiliate_commission ELSE 0 END) as pending_commissions
      FROM transactions
      WHERE affiliate_id = ${affiliateId}
    `

    // Get approved products count
    const productsCountQuery = await sql`
      SELECT COUNT(*) as approved_products
      FROM affiliate_links
      WHERE affiliate_id = ${affiliateId}
    `

    // Get monthly performance
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

    // Get top products
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

    return Response.json(response)
  } catch (error) {
    console.error("[v0] Affiliate dashboard stats error:", error)
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
