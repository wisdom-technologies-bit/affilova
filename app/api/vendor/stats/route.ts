import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get vendor ID
    const [vendor] = await sql`
      SELECT id FROM vendors WHERE user_id = ${session.userId}
    `

    if (!vendor) {
      return NextResponse.json({ error: "Vendor profile not found" }, { status: 404 })
    }

    // Get vendor products stats
    const [productStats] = await sql`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN is_active = false THEN 1 END) as pending_products
      FROM products
      WHERE vendor_id = ${vendor.id}
    `

    // Get sales stats
    const [salesStats] = await sql`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(amount), 0) as total_revenue
      FROM transactions
      WHERE vendor_id = ${vendor.id} AND payment_status = 'completed'
    `

    // Get active affiliates count
    const [affiliateStats] = await sql`
      SELECT COUNT(DISTINCT affiliate_id) as active_affiliates
      FROM affiliate_applications
      WHERE product_id IN (SELECT id FROM products WHERE vendor_id = ${vendor.id})
      AND status = 'approved'
    `

    // Calculate monthly growth (simplified - comparing this month to last month)
    const [monthlyStats] = await sql`
      SELECT 
        COUNT(CASE WHEN EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW()) THEN 1 END) as current_month_sales,
        COUNT(CASE WHEN EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW() - INTERVAL '1 month') THEN 1 END) as last_month_sales
      FROM transactions
      WHERE vendor_id = ${vendor.id} AND payment_status = 'completed'
    `

    const currentMonthSales = Number.parseInt(monthlyStats.current_month_sales) || 0
    const lastMonthSales = Number.parseInt(monthlyStats.last_month_sales) || 0
    const monthlyGrowth = lastMonthSales > 0 ? ((currentMonthSales - lastMonthSales) / lastMonthSales) * 100 : 0

    return NextResponse.json({
      totalProducts: Number.parseInt(productStats.total_products) || 0,
      pendingProducts: Number.parseInt(productStats.pending_products) || 0,
      activeAffiliates: Number.parseInt(affiliateStats.active_affiliates) || 0,
      totalSales: Number.parseInt(salesStats.total_sales) || 0,
      totalRevenue: Number.parseInt(salesStats.total_revenue) || 0,
      monthlyGrowth: Math.round(monthlyGrowth * 100) / 100, // Round to 2 decimal places
    })
  } catch (error) {
    console.error("Get vendor stats error:", error)
    return NextResponse.json({ error: "Failed to fetch vendor stats" }, { status: 500 })
  }
}
