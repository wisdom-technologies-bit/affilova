import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest) {
  try {
    console.log("Vendor analytics API called")

    const user = await verifyAuth()
    if (!user || user.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Number.parseInt(searchParams.get("days") || "30")

    console.log("Fetching analytics for vendor:", user.id, "for", days, "days")

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get total revenue and sales
    const revenueResult = await sql`
      SELECT 
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COUNT(t.id) as total_sales
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      WHERE p.vendor_id = ${user.id}
      AND t.status = 'completed'
      AND t.created_at >= ${startDate.toISOString()}
      AND t.created_at <= ${endDate.toISOString()}
    `

    // Get total affiliates
    const affiliatesResult = await sql`
      SELECT COUNT(DISTINCT t.affiliate_id) as total_affiliates
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      WHERE p.vendor_id = ${user.id}
      AND t.affiliate_id IS NOT NULL
      AND t.created_at >= ${startDate.toISOString()}
      AND t.created_at <= ${endDate.toISOString()}
    `

    // Get total views (using affiliate clicks as proxy)
    const viewsResult = await sql`
      SELECT COUNT(ac.id) as total_views
      FROM affiliate_clicks ac
      JOIN products p ON ac.product_id = p.id
      WHERE p.vendor_id = ${user.id}
      AND ac.created_at >= ${startDate.toISOString()}
      AND ac.created_at <= ${endDate.toISOString()}
    `

    // Get top performing products
    const topProductsResult = await sql`
      SELECT 
        p.alphanumeric_id as id,
        p.title,
        COUNT(t.id) as sales,
        COALESCE(SUM(t.amount), 0) as revenue,
        COUNT(DISTINCT ac.id) as views
      FROM products p
      LEFT JOIN transactions t ON p.id = t.product_id AND t.status = 'completed'
        AND t.created_at >= ${startDate.toISOString()}
        AND t.created_at <= ${endDate.toISOString()}
      LEFT JOIN affiliate_clicks ac ON p.id = ac.product_id
        AND ac.created_at >= ${startDate.toISOString()}
        AND ac.created_at <= ${endDate.toISOString()}
      WHERE p.vendor_id = ${user.id}
      GROUP BY p.id, p.alphanumeric_id, p.title
      HAVING COUNT(t.id) > 0 OR COUNT(DISTINCT ac.id) > 0
      ORDER BY revenue DESC
      LIMIT 5
    `

    // Get top performing affiliates
    const topAffiliatesResult = await sql`
      SELECT 
        u.alphanumeric_id as id,
        u.first_name || ' ' || u.last_name as name,
        COUNT(t.id) as sales,
        COALESCE(SUM(t.amount), 0) as revenue
      FROM users u
      JOIN transactions t ON u.id = t.affiliate_id
      JOIN products p ON t.product_id = p.id
      WHERE p.vendor_id = ${user.id}
      AND t.status = 'completed'
      AND t.created_at >= ${startDate.toISOString()}
      AND t.created_at <= ${endDate.toISOString()}
      GROUP BY u.id, u.alphanumeric_id, u.first_name, u.last_name
      ORDER BY revenue DESC
      LIMIT 5
    `

    const analytics = {
      totalRevenue: Number.parseFloat(revenueResult[0]?.total_revenue || 0),
      totalSales: Number.parseInt(revenueResult[0]?.total_sales || 0),
      totalAffiliates: Number.parseInt(affiliatesResult[0]?.total_affiliates || 0),
      totalViews: Number.parseInt(viewsResult[0]?.total_views || 0),
      topProducts: topProductsResult.map((product) => ({
        id: product.id,
        title: product.title,
        sales: Number.parseInt(product.sales || 0),
        revenue: Number.parseFloat(product.revenue || 0),
        views: Number.parseInt(product.views || 0),
      })),
      affiliatePerformance: topAffiliatesResult.map((affiliate) => ({
        id: affiliate.id,
        name: affiliate.name || "Unknown",
        sales: Number.parseInt(affiliate.sales || 0),
        revenue: Number.parseFloat(affiliate.revenue || 0),
      })),
    }

    console.log("Analytics data prepared:", analytics)

    return NextResponse.json({ analytics })
  } catch (error) {
    console.error("Vendor analytics error:", error)
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 })
  }
}
