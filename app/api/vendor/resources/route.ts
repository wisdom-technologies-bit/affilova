import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("Vendor resources API called")

    const user = await verifyAuth()
    if (!user || user.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Fetching resources for vendor")

    // For now, return static resources. In production, these would come from the database
    const resources = [
      {
        id: "1",
        title: "Product Listing Best Practices",
        description: "Learn how to create compelling product listings that attract affiliates and convert customers.",
        type: "guide",
        category: "product-management",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "2",
        title: "Commission Structure Guide",
        description: "How to set competitive commission rates that attract top-performing affiliates.",
        type: "guide",
        category: "affiliate-management",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "3",
        title: "Marketing Asset Templates",
        description: "Ready-to-use banners, social media posts, and email templates for your affiliates.",
        type: "template",
        category: "marketing-materials",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "4",
        title: "Analytics Deep Dive",
        description: "Video tutorial on how to interpret your sales data and optimize your strategy.",
        type: "video",
        category: "analytics",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "5",
        title: "Affiliate Recruitment Strategies",
        description: "Proven methods to attract and retain high-quality affiliate partners.",
        type: "guide",
        category: "affiliate-management",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "6",
        title: "Product Photography Guidelines",
        description: "Tips and best practices for creating professional product images that sell.",
        type: "document",
        category: "product-management",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "7",
        title: "Seasonal Marketing Calendar",
        description: "Plan your marketing campaigns around key shopping seasons and holidays.",
        type: "template",
        category: "marketing-materials",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "8",
        title: "Customer Support Excellence",
        description: "How to provide exceptional customer service that leads to repeat sales and positive reviews.",
        type: "guide",
        category: "customer-service",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
    ]

    console.log("Resources fetched:", resources.length)

    return NextResponse.json({ resources })
  } catch (error) {
    console.error("Vendor resources error:", error)
    return NextResponse.json({ error: "Failed to fetch resources" }, { status: 500 })
  }
}
