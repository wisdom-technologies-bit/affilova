import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
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
        p.rating_count,
        c.name as category_name,
        c.slug as category_slug,
        u.first_name as author_name
      FROM blog_posts p
      LEFT JOIN blog_categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC
      LIMIT 50
    `

    const categories = await sql`
      SELECT id, name, slug, description
      FROM blog_categories
      ORDER BY name ASC
    `

    // Get popular posts (more than 10 reads and has comments)
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
        AND COALESCE(p.read_count, 0) >= 10 
        AND COALESCE(p.comment_count, 0) > 0
      ORDER BY p.read_count DESC, p.comment_count DESC
      LIMIT 6
    `

    // Get recommended posts (rating >= 3.5 and has comments)
    const recommendedPosts = await sql`
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
        AND COALESCE(p.average_rating, 0) >= 3.5 
        AND COALESCE(p.comment_count, 0) > 0
      ORDER BY p.average_rating DESC, p.comment_count DESC
      LIMIT 6
    `

    return NextResponse.json({
      posts,
      categories,
      popularPosts,
      recommendedPosts,
    })
  } catch (error) {
    console.error("Get blog posts error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
