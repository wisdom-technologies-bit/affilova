import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    // Get client IP for read tracking
    const forwardedFor = request.headers.get("x-forwarded-for")
    const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown"

    const result = await sql`
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.content,
        p.excerpt,
        p.image_url,
        p.hero_image_url,
        p.published_at,
        p.read_count,
        p.comment_count,
        p.average_rating,
        p.rating_count,
        c.name as category_name,
        c.slug as category_slug,
        u.first_name as author_name,
        u.profile_picture_url as author_avatar
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.slug = ${slug} AND p.status = 'published'
    `

    if (!result || result.length === 0) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 })
    }

    const post = result[0]

    // Track read (upsert to avoid duplicates)
    let newReadCount = post.read_count || 0
    try {
      const insertResult = await sql`
        INSERT INTO blog_reads (post_id, reader_ip)
        VALUES (${post.id}, ${clientIp})
        ON CONFLICT (post_id, reader_ip) DO NOTHING
        RETURNING id
      `

      // If a new read was inserted, increment the count
      if (insertResult.length > 0) {
        await sql`
          UPDATE blog_posts 
          SET read_count = COALESCE(read_count, 0) + 1
          WHERE id = ${post.id}
        `
        newReadCount = (post.read_count || 0) + 1
      }
    } catch (e) {
      // Silently fail read tracking - don't break the page
      console.error("Read tracking error:", e)
    }

    const popularPosts = await sql`
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
        c.slug as category_slug
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      WHERE p.status = 'published' 
        AND p.id != ${post.id}
        AND COALESCE(p.read_count, 0) >= 10 
        AND COALESCE(p.comment_count, 0) > 0
      ORDER BY p.read_count DESC, p.comment_count DESC
      LIMIT 6
    `

    return NextResponse.json({
      post: { ...post, read_count: newReadCount },
      popularPosts,
    })
  } catch (error) {
    console.error("Get blog post error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
