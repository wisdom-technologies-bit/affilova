import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { verifyAuth } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    console.log("Affiliate resources API called")

    const user = await verifyAuth()
    if (!user || user.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Fetching resources for affiliate")

    // For now, return static resources. In production, these would come from the database
    const resources = [
      {
        id: "1",
        title: "Affiliate Marketing Basics",
        description:
          "Learn the fundamentals of affiliate marketing and how to get started with promoting products effectively.",
        type: "guide",
        category: "getting-started",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "2",
        title: "Social Media Templates",
        description:
          "Ready-to-use social media post templates for promoting affiliate products across different platforms.",
        type: "template",
        category: "social-media",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "3",
        title: "Email Marketing Guide",
        description: "Best practices for email marketing and how to build an email list for affiliate promotions.",
        type: "guide",
        category: "email-marketing",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "4",
        title: "Product Banner Images",
        description: "High-quality banner images for popular products that you can use in your marketing campaigns.",
        type: "image",
        category: "creative-assets",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "5",
        title: "Conversion Optimization Tips",
        description: "Video tutorial on how to optimize your affiliate links and landing pages for better conversions.",
        type: "video",
        category: "optimization",
        external_url: "#",
        created_at: new Date().toISOString(),
      },
      {
        id: "6",
        title: "Content Calendar Template",
        description:
          "A comprehensive content calendar template to help you plan and organize your affiliate marketing content.",
        type: "template",
        category: "planning",
        file_url: "#",
        created_at: new Date().toISOString(),
      },
    ]

    console.log("Resources fetched:", resources.length)

    return NextResponse.json({ resources })
  } catch (error) {
    console.error("Affiliate resources error:", error)
    return NextResponse.json({ error: "Failed to fetch resources" }, { status: 500 })
  }
}
