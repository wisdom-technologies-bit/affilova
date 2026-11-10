import { neon } from "@neondatabase/serverless"
import { cookies } from "next/headers"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("[v0] Vendor dashboard stats API called")

    const cookieStore = await cookies()
    const userId = cookieStore.get("user_id")?.value
    console.log("[v0] User ID from cookie:", userId)

    if (!userId) {
      console.log("[v0] No user ID found in cookies")
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get vendor ID
    console.log("[v0] Fetching vendor ID for user:", userId)
    const vendorResult = await sql`SELECT id FROM vendors WHERE user_id = ${userId}`
    console.log("[v0] Vendor query result:", vendorResult)

    if (!vendorResult.length) {
      console.log("[v0] No vendor found for user:", userId)
      return Response.json({ error: "Vendor not found" }, { status: 404 })
    }

    const vendorId = vendorResult[0].id
    console.log("[v0] Vendor ID:", vendorId)

    // Get product stats
    console.log("[v0] Fetching product stats for vendor:", vendorId)
    const productStatsResult = await sql`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_products
      FROM products
      WHERE vendor_id = ${vendorId}
    `
    console.log("[v0] Product stats:", productStatsResult[0])

    // Get sales stats
    console.log("[v0] Fetching sales stats for vendor:", vendorId)
    const salesStatsResult = await sql`
      SELECT 
        COUNT(*) as total_sales,
        SUM(amount) as total_revenue,
        SUM(vendor_payout) as vendor_earnings
      FROM transactions
      WHERE vendor_id = ${vendorId} AND payment_status = 'completed'
    `
    console.log("[v0] Sales stats:", salesStatsResult[0])

    // Get affiliate stats
    console.log("[v0] Fetching affiliate stats for vendor:", vendorId)
    const affiliateStatsResult = await sql`
      SELECT COUNT(DISTINCT affiliate_id) as active_affiliates
      FROM affiliate_links
      WHERE product_id IN (SELECT id FROM products WHERE vendor_id = ${vendorId})
    `
    console.log("[v0] Affiliate stats:", affiliateStatsResult[0])

    // Get monthly sales trend
    console.log("[v0] Fetching monthly sales trend for vendor:", vendorId)
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
    console.log("[v0] Monthly sales data points:", monthlySalesResult.length)

    // Get top products
    console.log("[v0] Fetching top products for vendor:", vendorId)
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
    console.log("[v0] Top products count:", topProductsResult.length)

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

    console.log("[v0] Vendor dashboard stats response prepared successfully")
    return Response.json(response)
  } catch (error) {
    console.error("[v0] Vendor dashboard stats error:", error)
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
