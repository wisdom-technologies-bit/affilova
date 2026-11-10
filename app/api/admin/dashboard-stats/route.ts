import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("[v0] Admin dashboard stats API called")

    // Get user stats
    console.log("[v0] Fetching user stats...")
    const userStats = await sql`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'vendor' THEN 1 ELSE 0 END) as total_vendors,
        SUM(CASE WHEN role = 'affiliate' THEN 1 ELSE 0 END) as total_affiliates
      FROM users
      WHERE is_active = true
    `
    console.log("[v0] User stats:", userStats[0])

    // Get product stats
    console.log("[v0] Fetching product stats...")
    const productStats = await sql`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_products
      FROM products
    `
    console.log("[v0] Product stats:", productStats[0])

    // Get transaction stats
    console.log("[v0] Fetching transaction stats...")
    const transactionStats = await sql`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(amount) as total_sales,
        SUM(platform_fee) as platform_earnings,
        SUM(CASE WHEN payment_status = 'completed' THEN 1 ELSE 0 END) as completed_transactions
      FROM transactions
    `
    console.log("[v0] Transaction stats:", transactionStats[0])

    // Get withdrawal stats
    console.log("[v0] Fetching withdrawal stats...")
    const withdrawalStats = await sql`
      SELECT 
        COUNT(*) as total_withdrawals,
        SUM(amount) as total_withdrawn,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_withdrawals
      FROM withdrawal_requests
    `
    console.log("[v0] Withdrawal stats:", withdrawalStats[0])

    // Get support tickets
    console.log("[v0] Fetching support ticket stats...")
    const supportStats = await sql`
      SELECT 
        COUNT(*) as total_tickets,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_tickets
      FROM support_tickets
    `
    console.log("[v0] Support stats:", supportStats[0])

    // Get monthly revenue trend (last 12 months)
    console.log("[v0] Fetching monthly revenue trend...")
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
    console.log("[v0] Monthly revenue data points:", monthlyRevenue.length)

    // Get top vendors by sales
    console.log("[v0] Fetching top vendors...")
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
    console.log("[v0] Top vendors count:", topVendors.length)

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

    console.log("[v0] Admin dashboard stats response prepared successfully")
    return Response.json(response)
  } catch (error) {
    console.error("[v0] Dashboard stats error:", error)
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
