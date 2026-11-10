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

    // Reject the product (delete it)
    await sql`
      DELETE FROM products 
      WHERE alphanumeric_id = ${productId}
    `

    // Send rejection email to vendor
    if (product.vendor_email) {
      await brevoService.sendEmail({
        to: [{ email: product.vendor_email, name: product.vendor_name }],
        subject: `Product Rejected - ${product.title}`,
        htmlContent: `
          <h1 style="color: #ef4444; margin-bottom: 20px;">Product Rejected</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${product.vendor_name},</p>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            We regret to inform you that your product "${product.title}" has been rejected and cannot be listed on the Affilova marketplace at this time.
          </p>
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Product:</strong> ${product.title}</p>
            <p style="margin: 10px 0 0 0; font-size: 14px; color: #374151;">
              <strong>Common reasons for rejection:</strong><br>
              • Product doesn't meet our quality standards<br>
              • Incomplete or misleading product information<br>
              • Prohibited product category<br>
              • Copyright or trademark issues
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            If you believe this was an error or would like more specific feedback, please contact our support team. You're welcome to resubmit your product after addressing any issues.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/contact" 
               style="background: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
              Contact Support
            </a>
          </div>
        `,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Reject product error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
