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

    // Get vendor ID
    const vendorResult = await sql`SELECT id FROM vendors WHERE user_id = ${userId}`

    if (!vendorResult.length) {
      return Response.json({ error: "Vendor not found" }, { status: 404 })
    }

    const vendorId = vendorResult[0].id

    // Get product stats
    const productStatsResult = await sql`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_products
      FROM products
      WHERE vendor_id = ${vendorId}
    `

    // Get sales stats
    const salesStatsResult = await sql`
      SELECT 
        COUNT(*) as total_sales,
        SUM(amount) as total_revenue,
        SUM(vendor_payout) as vendor_earnings
      FROM transactions
      WHERE vendor_id = ${vendorId} AND payment_status = 'completed'
    `

    // Get affiliate stats
    const affiliateStatsResult = await sql`
      SELECT COUNT(DISTINCT affiliate_id) as active_affiliates
      FROM affiliate_links
      WHERE product_id IN (SELECT id FROM products WHERE vendor_id = ${vendorId})
    `

    // Get monthly sales trend
    const monthlySalesResult = await sql`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as sales_count,
        SUM(amount) as revenue
      FROM transactions
      WHERE vendor_id = ${vendorId} AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `

    // Get top products
    const topProductsResult = await sql`
      SELECT 
        p.id,
        p.title,
        COUNT(t.id) as sales_count,
        SUM(t.amount) as total_revenue
      FROM products p
      LEFT JOIN transactions t ON p.id = t.product_id
      WHERE p.vendor_id = ${vendorId}
      GROUP BY p.id, p.title
      ORDER BY total_revenue DESC
      LIMIT 5
    `

    const response = {
      products: productStatsResult[0],
      sales: salesStatsResult[0],
      affiliates: affiliateStatsResult[0],
      monthlySales: monthlySalesResult.map((row) => ({
        month: new Date(row.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        sales: row.sales_count,
        revenue: Number(row.revenue) / 100,
      })),
      topProducts: topProductsResult.map((row) => ({
        name: row.title,
        sales: row.sales_count,
        revenue: Number(row.total_revenue) / 100,
      })),
    }

    return Response.json(response)
  } catch (error) {
    console.error("[v0] Vendor dashboard stats error:", error)
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
