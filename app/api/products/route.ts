import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { generateLongAlphanumericId } from "@/lib/utils"
import { brevoService } from "@/lib/brevo"
import { z } from "zod"

const createProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  commissionRate: z.number().min(0).max(100),
  category: z.string().optional(),
  imageUrl: z.string().url().optional(),
  salesPageUrl: z.string().url().optional(),
  thankYouPageUrl: z.string().url().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = createProductSchema.parse(body)

    // Get vendor by user ID
    const [vendor] = await sql`
      SELECT id, alphanumeric_id FROM vendors WHERE user_id = ${session.userId}
    `

    if (!vendor) {
      return NextResponse.json({ error: "Vendor profile not found" }, { status: 404 })
    }

    // Generate unique alphanumeric ID for product
    let productId = generateLongAlphanumericId()
    let attempts = 0

    while (attempts < 10) {
      const existingId = await sql`
        SELECT alphanumeric_id FROM products WHERE alphanumeric_id = ${productId}
      `
      if (existingId.length === 0) break
      productId = generateLongAlphanumericId()
      attempts++
    }

    if (attempts >= 10) {
      return NextResponse.json({ error: "Unable to generate unique product ID" }, { status: 500 })
    }

    // Create product
    const [product] = await sql`
      INSERT INTO products (
        alphanumeric_id, vendor_id, title, description, price, commission_rate,
        category, image_url, sales_page_url, thank_you_page_url
      )
      VALUES (
        ${productId}, ${vendor.id}, ${validatedData.title}, ${validatedData.description || null},
        ${validatedData.price}, ${validatedData.commissionRate},
        ${validatedData.category || null}, ${validatedData.imageUrl || null},
        ${validatedData.salesPageUrl || null}, ${validatedData.thankYouPageUrl || null}
      )
      RETURNING *
    `

    // Get vendor user details for email
    const [vendorUser] = await sql`
      SELECT email, first_name FROM users WHERE id = ${session.userId}
    `

    if (vendorUser) {
      await brevoService.sendProductListedEmail(vendorUser.email, vendorUser.first_name, validatedData.title)
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error("Create product error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const vendorOnly = searchParams.get("vendor") === "true"

    let products

    if (session.role === "vendor" && vendorOnly) {
      // Get vendor's products only
      const [vendor] = await sql`
        SELECT id FROM vendors WHERE user_id = ${session.userId}
      `

      if (!vendor) {
        return NextResponse.json({ error: "Vendor profile not found" }, { status: 404 })
      }

      products = await sql`
        SELECT p.*, v.user_id as vendor_user_id, u.first_name, u.last_name, u.company_name
        FROM products p
        JOIN vendors v ON p.vendor_id = v.id
        JOIN users u ON v.user_id = u.id
        WHERE p.vendor_id = ${vendor.id}
        ORDER BY p.created_at DESC
      `
    } else {
      // Get all active products
      products = await sql`
        SELECT p.*, v.user_id as vendor_user_id, u.first_name, u.last_name, u.company_name
        FROM products p
        JOIN vendors v ON p.vendor_id = v.id
        JOIN users u ON v.user_id = u.id
        WHERE p.is_active = true
        ORDER BY p.created_at DESC
      `
    }

    return NextResponse.json({ products })
  } catch (error) {
    console.error("Get products error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
