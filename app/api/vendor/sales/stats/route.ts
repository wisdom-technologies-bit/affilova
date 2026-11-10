import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { getSession } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest) {
  try {
    console.log("Vendor sales stats API called")

    const session = await getSession()
    if (!session || session.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Number.parseInt(searchParams.get("days") || "30")

    console.log("Fetching sales stats for vendor:", session.userId, "days:", days)

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const statsResult = await sql`
      SELECT 
        COUNT(t.id) as total_sales,
        COALESCE(SUM(t.amount), 0) as total_revenue,
        COALESCE(SUM(t.commission_amount), 0) as total_commissions,
        COUNT(DISTINCT ac.id) as total_clicks
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN affiliate_clicks ac ON ac.product_id = p.id 
        AND ac.created_at >= ${startDate.toISOString()}
        AND ac.created_at <= ${endDate.toISOString()}
      WHERE p.vendor_id = ${session.userId}
      AND t.status = 'completed'
      AND t.created_at >= ${startDate.toISOString()}
      AND t.created_at <= ${endDate.toISOString()}
    `

    const result = statsResult[0]
    const totalSales = Number.parseInt(result?.total_sales || 0)
    const totalClicks = Number.parseInt(result?.total_clicks || 0)
    const conversionRate = totalClicks > 0 ? (totalSales / totalClicks) * 100 : 0

    const stats = {
      total_sales: totalSales,
      total_revenue: Number.parseFloat(result?.total_revenue || 0),
      total_commissions: Number.parseFloat(result?.total_commissions || 0),
      conversion_rate: conversionRate,
    }

    console.log("Sales stats calculated:", stats)

    return NextResponse.json({ stats })
  } catch (error) {
    console.error("Vendor sales stats error:", error)
    return NextResponse.json({ error: "Failed to fetch sales stats" }, { status: 500 })
  }
}
