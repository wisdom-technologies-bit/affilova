import { type NextRequest, NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"
import { cookies } from "next/headers"

import { verifyToken } from "@/lib/auth"

const sql = neon(process.env.DATABASE_URL!)

// Get comments for a post
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const postId = searchParams.get("postId")

    if (!postId) {
      return NextResponse.json({ error: "Post ID required" }, { status: 400 })
    }

    const comments = await sql`
      SELECT 
        c.id,
        c.content,
        c.created_at,
        c.user_id,
        c.author_name,
        c.author_email,
        u.first_name,
        u.last_name,
        u.profile_picture_url
      FROM blog_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ${postId} AND c.is_approved = true
      ORDER BY c.created_at DESC
    `

    return NextResponse.json({ comments })
  } catch (error) {
    console.error("Get comments error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Add a new comment (supports both authenticated and anonymous users)
export async function POST(request: NextRequest) {
  try {
    const { postId, content, authorName, authorEmail } = await request.json()

    if (!postId || !content?.trim()) {
      return NextResponse.json({ error: "Post ID and content required" }, { status: 400 })
    }

    let userId: string | null = null
    let commentAuthorName = authorName
    let commentAuthorEmail = authorEmail

    // Check if user is authenticated
    const cookieStore = await cookies()
    const token = cookieStore.get("auth_token")?.value

    if (token) {
      const session = await verifyToken(token)

      if (!session) {
        console.log("Token verification failed, proceeding as anonymous")
      } else {
        userId = session.userId

        try {
          // Get user info if authenticated
          const user = await sql`
            SELECT first_name, last_name, email
            FROM users WHERE id = ${userId}
          `

          if (user[0]) {
            commentAuthorName = `${user[0]?.first_name || ""} ${user[0]?.last_name || ""}`.trim() || "User"
            commentAuthorEmail = user[0]?.email
          }
        } catch {
          console.log("User lookup failed, keeping the submitted author details")
        }
      }
    }

    // Validate author info for anonymous comments
    if (!userId) {
      if (!commentAuthorName?.trim() || !commentAuthorEmail?.trim()) {
        return NextResponse.json(
          { error: "Name and email required for anonymous comments" },
          { status: 400 }
        )
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(commentAuthorEmail)) {
        return NextResponse.json({ error: "Valid email address required" }, { status: 400 })
      }
    }

    // Insert comment (approved by default for authenticated users, pending for anonymous)
    const isApproved = userId ? true : false
    const result = await sql`
      INSERT INTO blog_comments (
        post_id, 
        user_id, 
        content, 
        author_name, 
        author_email,
        is_approved
      )
      VALUES (
        ${postId}, 
        ${userId || null}, 
        ${content.trim()}, 
        ${commentAuthorName || null}, 
        ${commentAuthorEmail || null},
        ${isApproved}
      )
      RETURNING id, content, created_at, author_name, author_email
    `

    // Update comment count on the post
    await sql`
      UPDATE blog_posts 
      SET comment_count = (SELECT COUNT(*) FROM blog_comments WHERE post_id = ${postId} AND is_approved = true)
      WHERE id = ${postId}
    `

    return NextResponse.json({
      comment: {
        ...result[0],
        user_id: userId,
        first_name: commentAuthorName?.split(" ")[0] || "Anonymous",
        last_name: commentAuthorName?.split(" ").slice(1).join(" ") || "",
        profile_picture_url: null,
      },
      message: isApproved ? "Comment posted successfully!" : "Comment submitted for moderation",
    })
  } catch (error) {
    console.error("Add comment error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
