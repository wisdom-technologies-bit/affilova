import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { title, slug, content, excerpt, status, category_id, image_url, hero_image_url } = body

    const publishedAt = status === "published" ? new Date() : null

    const result = await sql`
      UPDATE blog_posts
      SET title = ${title}, slug = ${slug}, content = ${content}, excerpt = ${excerpt || null}, 
          status = ${status}, category_id = ${category_id || null}, image_url = ${image_url || null},
          hero_image_url = ${hero_image_url || null}, published_at = ${publishedAt}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `

    return NextResponse.json(result[0])
  } catch (error) {
    console.error("Update blog error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await sql`DELETE FROM blog_posts WHERE id = ${id}`

    return NextResponse.json({ message: "Blog post deleted" })
  } catch (error) {
    console.error("Delete blog error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
