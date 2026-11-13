import { neon } from "@neondatabase/serverless"

import { requireRole } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  const auth = await requireRole(["admin"])

  if (!auth.ok) {
    return auth.status === 401
      ? Response.json({ error: "Unauthorized" }, { status: 401 })
      : Response.json({ error: "Forbidden" }, { status: 403 })
  }

  try {

    // Get user stats
    const userStats = await sql`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'vendor' THEN 1 ELSE 0 END) as total_vendors,
        SUM(CASE WHEN role = 'affiliate' THEN 1 ELSE 0 END) as total_affiliates
      FROM users
      WHERE is_active = true
    `

    // Get product stats
    const productStats = await sql`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_products
      FROM products
    `

    // Get transaction stats
    const transactionStats = await sql`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_sales,
        SUM(platform_fee) as platform_earnings,
        SUM(CASE WHEN payment_status = 'completed' THEN 1 ELSE 0 END) as completed_transactions
      FROM transactions
    `

    // Get withdrawal stats
    const withdrawalStats = await sql`
      SELECT 
        COUNT(*) as total_withdrawals,
        SUM(amount) as total_withdrawn,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_withdrawals
      FROM withdrawal_requests
    `

    // Get support tickets
    const supportStats = await sql`
      SELECT 
        COUNT(*) as total_tickets,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_tickets
      FROM support_tickets
    `

    // Get monthly revenue trend (last 12 months)
    const monthlyRevenue = await sql`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        SUM(platform_fee) as revenue,
        COUNT(*) as transactions
      FROM transactions
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `

    // Get top vendors by sales
    const topVendors = await sql`
      SELECT 
        v.id,
        u.first_name || ' ' || u.last_name as vendor_name,
        COUNT(t.id) as sales_count,
        SUM(t.amount) as total_sales
      FROM vendors v
      JOIN users u ON v.user_id = u.id
      LEFT JOIN transactions t ON v.id = t.vendor_id
      GROUP BY v.id, u.first_name, u.last_name
      ORDER BY total_sales DESC
      LIMIT 5
    `

    const response = {
      users: userStats[0],
      products: productStats[0],
      transactions: transactionStats[0],
      withdrawals: withdrawalStats[0],
      support: supportStats[0],
      monthlyRevenue: monthlyRevenue.map((row) => ({
        month: new Date(row.month).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        revenue: Number(row.revenue) / 100,
        transactions: row.transactions,
      })),
      topVendors: topVendors.map((row) => ({
        name: row.vendor_name,
        sales: row.sales_count,
        revenue: Number(row.total_sales) / 100,
      })),
    }

    return Response.json(response)
  } catch (error) {
    console.error("dashboard-stats failed")
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
