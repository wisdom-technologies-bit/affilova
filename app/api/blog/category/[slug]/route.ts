import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    // Get category info
    const categoryResult = await sql`
      SELECT id, name, slug, description
      FROM blog_categories
      WHERE slug = ${slug}
    `

    if (!categoryResult || categoryResult.length === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }

    const category = categoryResult[0]

    // Get posts in this category
    const posts = await sql`
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.excerpt,
        p.image_url,
        p.hero_image_url,
        p.published_at,
        p.read_count,
        p.comment_count,
        p.average_rating,
        c.name as category_name,
        c.slug as category_slug,
        u.first_name as author_name
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.status = 'published' AND c.slug = ${slug}
      ORDER BY p.published_at DESC
    `

    // Get all categories for sidebar
    const categories = await sql`
      SELECT id, name, slug, description
      FROM blog_categories
      ORDER BY name ASC
    `

    return NextResponse.json({
      category,
      posts,
      categories,
    })
  } catch (error) {
    console.error("Get category posts error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
