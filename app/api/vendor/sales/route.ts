import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest) {
  try {
    console.log("Vendor sales API called")

    const user = await verifyAuth()
    if (!user || user.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = Number.parseInt(searchParams.get("days") || "30")
    const status = searchParams.get("status") || "all"

    console.log("Fetching sales for vendor:", user.id, "days:", days, "status:", status)

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    let statusCondition = ""
    if (status !== "all") {
      statusCondition = `AND t.status = '${status}'`
    }

    const salesResult = await sql`
      SELECT 
        t.alphanumeric_id as id,
        p.title as product_title,
        p.image_url as product_image,
        t.customer_email,
        COALESCE(u.first_name || ' ' || u.last_name, 'Direct Sale') as affiliate_name,
        t.amount,
        t.commission_amount,
        t.status,
        t.created_at,
        t.payment_method
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.affiliate_id = u.id
      WHERE p.vendor_id = ${user.id}
      AND t.created_at >= ${startDate.toISOString()}
      AND t.created_at <= ${endDate.toISOString()}
      ${status !== "all" ? sql`AND t.status = ${status}` : sql``}
      ORDER BY t.created_at DESC
      LIMIT 100
    `

    const sales = salesResult.map((sale) => ({
      id: sale.id,
      product_title: sale.product_title,
      product_image: sale.product_image,
      customer_email: sale.customer_email,
      affiliate_name: sale.affiliate_name !== "Direct Sale" ? sale.affiliate_name : undefined,
      amount: Number.parseFloat(sale.amount),
      commission_amount: Number.parseFloat(sale.commission_amount || 0),
      status: sale.status,
      created_at: sale.created_at,
      payment_method: sale.payment_method || "Card",
    }))

    console.log("Sales fetched:", sales.length)

    return NextResponse.json({ sales })
  } catch (error) {
    console.error("Vendor sales error:", error)
    return NextResponse.json({ error: "Failed to fetch sales" }, { status: 500 })
  }
}
