import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { cookies } from "next/headers"

import { verifyToken } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

// Rate a blog post (supports both authenticated and anonymous users via IP-based tracking)
export async function POST(request: NextRequest) {
  try {
    const { postId, rating } = await request.json()

    if (!postId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Valid post ID and rating (1-5) required" }, { status: 400 })
    }

    let userId: string | null = null
    let readerIp = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"

    // Check if user is authenticated
    const cookieStore = await cookies()
    const token = cookieStore.get("auth_token")?.value

    if (token) {
      const session = await verifyToken(token)

      if (session) {
        userId = session.userId
      } else {
        console.log("Token verification failed, proceeding with IP-based rating")
      }
    }

    // For authenticated users: upsert by user_id
    // For anonymous users: track by IP address to prevent duplicate ratings
    if (userId) {
      // Authenticated user - one rating per user
      await sql`
        INSERT INTO blog_ratings (post_id, user_id, rating)
        VALUES (${postId}, ${userId}, ${rating})
        ON CONFLICT (post_id, user_id) 
        DO UPDATE SET rating = ${rating}, updated_at = CURRENT_TIMESTAMP
      `
    } else {
      // Anonymous user - track by IP, one rating per IP per post per day
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      // Check if this IP has already rated this post in the last 24 hours
      const existingRating = await sql`
        SELECT id, rating
        FROM blog_ratings 
        WHERE post_id = ${postId} 
          AND reader_ip = ${readerIp}
          AND created_at > ${twentyFourHoursAgo.toISOString()}
      `

      if (existingRating.length > 0) {
        // Update existing rating from this IP
        await sql`
          UPDATE blog_ratings 
          SET rating = ${rating}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${existingRating[0].id}
        `
      } else {
        // Create new anonymous rating
        await sql`
          INSERT INTO blog_ratings (post_id, rating, reader_ip)
          VALUES (${postId}, ${rating}, ${readerIp})
        `
      }
    }

    // Update average rating on the post
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating, COUNT(*) as rating_count
      FROM blog_ratings WHERE post_id = ${postId}
    `

    await sql`
      UPDATE blog_posts 
      SET average_rating = ${avgResult[0]?.avg_rating || 0},
          rating_count = ${avgResult[0]?.rating_count || 0}
      WHERE id = ${postId}
    `

    return NextResponse.json({
      success: true,
      average_rating: avgResult[0]?.avg_rating,
      rating_count: avgResult[0]?.rating_count,
      message: userId ? "Rating saved!" : "Thank you for rating! (1 rating per IP per 24 hours)",
    })
  } catch (error) {
    console.error("Rate post error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
