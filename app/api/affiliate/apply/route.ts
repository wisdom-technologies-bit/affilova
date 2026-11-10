import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { generateLongAlphanumericId } from "@/lib/utils"
import { brevoService } from "@/lib/brevo"
import { z } from "zod"

const applySchema = z.object({
  productId: z.string().min(1),
  message: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { productId, message } = applySchema.parse(body)

    // Get affiliate ID
    const [affiliate] = await sql`
      SELECT id, alphanumeric_id FROM affiliates WHERE user_id = ${session.userId}
    `

    if (!affiliate) {
      return NextResponse.json({ error: "Affiliate profile not found" }, { status: 404 })
    }

    // Get product and vendor details
    const [product] = await sql`
      SELECT p.id, p.alphanumeric_id, p.title, p.auto_approve_affiliates,
             v.id as vendor_id, v.user_id as vendor_user_id,
             u.email as vendor_email, u.first_name as vendor_name
      FROM products p
      JOIN vendors v ON p.vendor_id = v.id
      JOIN users u ON v.user_id = u.id
      WHERE p.alphanumeric_id = ${productId} AND p.is_active = true
    `

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    // Check if already applied
    const [existingApplication] = await sql`
      SELECT id FROM affiliate_applications 
      WHERE affiliate_id = ${affiliate.id} AND product_id = ${product.id}
    `

    if (existingApplication) {
      return NextResponse.json({ error: "You have already applied for this product" }, { status: 400 })
    }

    // Create application
    const applicationId = generateLongAlphanumericId()
    const status = product.auto_approve_affiliates ? "approved" : "pending"

    const [application] = await sql`
      INSERT INTO affiliate_applications (
        alphanumeric_id, affiliate_id, product_id, status, application_message
      )
      VALUES (
        ${applicationId}, ${affiliate.id}, ${product.id}, ${status}, ${message || null}
      )
      RETURNING *
    `

    // If auto-approved, create affiliate link
    if (status === "approved") {
      const trackingCode = generateLongAlphanumericId()
      await sql`
        INSERT INTO affiliate_links (
          alphanumeric_id, affiliate_id, product_id, tracking_code
        )
        VALUES (
          ${generateLongAlphanumericId()}, ${affiliate.id}, ${product.id}, ${trackingCode}
        )
      `

      // Send approval email to affiliate
      await brevoService.sendAffiliateApprovalEmail(
        session.email,
        session.firstName || "Affiliate",
        product.title,
        product.vendor_name,
        true,
      )
    } else {
      // Send application notification to vendor
      await brevoService.sendAffiliateApplicationEmail(
        product.vendor_email,
        product.vendor_name,
        session.firstName || "Affiliate",
        product.title,
      )
    }

    return NextResponse.json({
      success: true,
      applicationId: applicationId,
      status: status,
      message:
        status === "approved"
          ? "Application approved! You can now promote this product."
          : "Application submitted successfully. Waiting for vendor approval.",
    })
  } catch (error) {
    console.error("Affiliate application error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data" }, { status: 400 })
    }

    return NextResponse.json({ error: "Failed to submit application" }, { status: 500 })
  }
}
