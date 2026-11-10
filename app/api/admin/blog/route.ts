import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const posts = await sql`
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.content,
        p.excerpt,
        p.status,
        p.featured,
        p.image_url,
        p.hero_image_url,
        p.category_id,
        c.name as category_name,
        p.created_at,
        p.published_at,
        p.updated_at,
        u.first_name as author_name
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.author_id = u.id
      ORDER BY p.created_at DESC
    `

    const categories = await sql`
      SELECT id, name, slug, description
      FROM blog_categories
      ORDER BY name ASC
    `

    return NextResponse.json({ posts, categories })
  } catch (error) {
    console.error("Get blog error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { title, slug, content, excerpt, status, category_id, image_url, hero_image_url } = body

    if (!title || !slug || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const publishedAt = status === "published" ? new Date() : null

    const result = await sql`
      INSERT INTO blog_posts (title, slug, content, excerpt, status, category_id, image_url, hero_image_url, author_id, published_at)
      VALUES (${title}, ${slug}, ${content}, ${excerpt || null}, ${status}, ${category_id || null}, ${image_url || null}, ${hero_image_url || null}, ${session.userId}, ${publishedAt})
      RETURNING *
    `

    return NextResponse.json(result[0], { status: 201 })
  } catch (error) {
    console.error("Create blog error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
