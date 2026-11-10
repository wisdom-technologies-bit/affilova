import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("Vendor affiliates API called")

    const user = await verifyAuth()
    if (!user || user.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Fetching affiliates for vendor:", user.id)

    // Get affiliates who have promoted this vendor's products
    const affiliatesResult = await sql`
      SELECT DISTINCT
        u.alphanumeric_id as id,
        u.first_name || ' ' || u.last_name as name,
        u.email,
        u.experience_level,
        u.marketing_channels,
        u.created_at as joined_date,
        CASE WHEN u.last_login > NOW() - INTERVAL '30 days' THEN 'active' ELSE 'inactive' END as status,
        COALESCE(stats.total_sales, 0) as total_sales,
        COALESCE(stats.total_commission, 0) as total_commission,
        COALESCE(stats.conversion_rate, 0) as conversion_rate
      FROM users u
      LEFT JOIN (
        SELECT 
          t.affiliate_id,
          COUNT(t.id) as total_sales,
          SUM(t.commission_amount) as total_commission,
          CASE 
            WHEN COUNT(ac.id) > 0 THEN (COUNT(t.id)::float / COUNT(ac.id)::float) * 100 
            ELSE 0 
          END as conversion_rate
        FROM transactions t
        JOIN products p ON t.product_id = p.id
        LEFT JOIN affiliate_clicks ac ON ac.product_id = p.id AND ac.affiliate_id = t.affiliate_id
        WHERE p.vendor_id = ${user.id}
        AND t.status = 'completed'
        GROUP BY t.affiliate_id
      ) stats ON stats.affiliate_id = u.id
      WHERE u.role = 'affiliate'
      AND EXISTS (
        SELECT 1 FROM transactions t2 
        JOIN products p2 ON t2.product_id = p2.id 
        WHERE t2.affiliate_id = u.id 
        AND p2.vendor_id = ${user.id}
      )
      ORDER BY stats.total_commission DESC NULLS LAST
    `

    const affiliates = affiliatesResult.map((affiliate) => ({
      id: affiliate.id,
      name: affiliate.name || "Unknown",
      email: affiliate.email,
      total_sales: Number.parseInt(affiliate.total_sales || 0),
      total_commission: Number.parseFloat(affiliate.total_commission || 0),
      conversion_rate: Number.parseFloat(affiliate.conversion_rate || 0),
      joined_date: affiliate.joined_date,
      status: affiliate.status,
      experience_level: affiliate.experience_level || "beginner",
      marketing_channels: affiliate.marketing_channels ? affiliate.marketing_channels.split(",") : [],
    }))

    console.log("Affiliates fetched:", affiliates.length)

    return NextResponse.json({ affiliates })
  } catch (error) {
    console.error("Vendor affiliates error:", error)
    return NextResponse.json({ error: "Failed to fetch affiliates" }, { status: 500 })
  }
}
