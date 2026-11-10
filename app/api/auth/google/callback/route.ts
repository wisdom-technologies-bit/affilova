import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { createToken, setAuthCookie } from "@/lib/auth"
import { verifyGoogleToken } from "@/lib/google-auth"
import { generateAlphanumericId } from "@/lib/utils"
import { brevoService } from "@/lib/brevo"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")

    if (!code) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/auth/login?error=no_code`)
    }

    // Exchange code for token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", tokenData)
      throw new Error("Failed to exchange code for token")
    }

    // Verify the ID token and get user info
    const userInfo = await verifyGoogleToken(tokenData.id_token)

    if (!userInfo) {
      throw new Error("Failed to verify Google token")
    }

    // Check if user exists
    const [existingUser] = await sql`
      SELECT id, alphanumeric_id, email, role, first_name, last_name, 
             is_verified, is_active, google_id, has_password, profile_picture_url, onboarding_completed
      FROM users 
      WHERE google_id = ${userInfo.id} OR email = ${userInfo.email}
    `

    let user
    let isNewUser = false
    let redirectUrl = "/"

    if (existingUser) {
      // Link Google account to existing email account and update profile picture
      if (!existingUser.google_id) {
        await sql`
          UPDATE users 
          SET google_id = ${userInfo.id}, profile_picture_url = ${userInfo.picture}, 
              is_verified = true
          WHERE id = ${existingUser.id}
        `
      }
      user = { ...existingUser, profile_picture_url: userInfo.picture }

      // Determine redirect URL
      if (!user.role || user.role === "user") {
        redirectUrl = "/dashboard/select-role"
      } else if (!user.onboarding_completed) {
        redirectUrl = `/onboarding/${user.role}`
      } else {
        redirectUrl = `/dashboard/${user.role}`
      }

      // Send login notification only for existing users who have completed onboarding
      if (user.onboarding_completed) {
        const loginTime = new Date().toLocaleString()
        await brevoService.sendLoginNotificationEmail(user.email, user.first_name, loginTime)
      }
    } else {
      // Generate unique alphanumeric ID
      let alphanumericId = generateAlphanumericId()
      let attempts = 0

      while (attempts < 10) {
        const existingId = await sql`
          SELECT alphanumeric_id FROM users WHERE alphanumeric_id = ${alphanumericId}
        `
        if (existingId.length === 0) break
        alphanumericId = generateAlphanumericId()
        attempts++
      }

      if (attempts >= 10) {
        throw new Error("Unable to generate unique ID")
      }

      const [newUser] = await sql`
        INSERT INTO users (
          alphanumeric_id, email, password_hash, google_id, role, first_name, last_name, 
          profile_picture_url, has_password, is_verified, onboarding_completed
        )
        VALUES (
          ${alphanumericId}, ${userInfo.email}, NULL, ${userInfo.id}, 'user',
          ${userInfo.given_name}, ${userInfo.family_name},
          ${userInfo.picture}, false, true, false
        )
        RETURNING id, alphanumeric_id, email, role, first_name, last_name, 
                  is_verified, is_active, google_id, has_password, profile_picture_url
      `
      user = newUser
      isNewUser = true
      redirectUrl = "/dashboard/select-role"
    }

    // Create JWT token
    const token = await createToken({
      userId: user.id,
      alphanumericId: user.alphanumeric_id,
      email: user.email,
      role: user.role,
    })

    await setAuthCookie(token)

    if (isNewUser || !user.role || user.role === "user") {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/select-role`)
    }
    if (user.role === "admin") {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/admin`)
    }
    if (!existingUser?.onboarding_completed) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/onboarding/${user.role}`)
    }
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${user.role}`)
  } catch (error) {
    console.error("Google OAuth callback error:", error)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/auth/login?error=oauth_failed`)
  }
}
