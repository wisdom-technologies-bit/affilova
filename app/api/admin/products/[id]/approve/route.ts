import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { brevoService } from "@/lib/brevo"

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const productId = params.id

    // Get product and vendor details
    const [product] = await sql`
      SELECT 
        p.*,
        v.user_id as vendor_user_id,
        u.email as vendor_email,
        u.first_name as vendor_name
      FROM products p
      JOIN vendors v ON p.vendor_id = v.id
      JOIN users u ON v.user_id = u.id
      WHERE p.alphanumeric_id = ${productId}
    `

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    // Approve the product
    await sql`
      UPDATE products 
      SET is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE alphanumeric_id = ${productId}
    `

    // Send approval email to vendor
    if (product.vendor_email) {
      await brevoService.sendEmail({
        to: [{ email: product.vendor_email, name: product.vendor_name }],
        subject: `Product Approved - ${product.title}`,
        htmlContent: `
          <h1 style="color: #22c55e; margin-bottom: 20px;">Product Approved!</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${product.vendor_name},</p>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            Great news! Your product "${product.title}" has been approved and is now live on the Affilova marketplace.
          </p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Product:</strong> ${product.title}</p>
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Price:</strong> ₦${product.price.toLocaleString()}</p>
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Commission Rate:</strong> ${product.commission_rate}%</p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            Affiliates can now discover and apply to promote your product. You'll receive notifications when affiliates apply and when sales are made.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/vendor/products" 
               style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
              View Your Products
            </a>
          </div>
        `,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Approve product error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
