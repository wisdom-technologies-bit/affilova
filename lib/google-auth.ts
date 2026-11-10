export interface GoogleUserInfo {
  id: string
  email: string
  name: string
  given_name: string
  family_name: string
  picture: string
  verified_email: boolean
}

export async function verifyGoogleToken(token: string): Promise<GoogleUserInfo | null> {
  try {
    // Use Google's tokeninfo endpoint to verify the token
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`)

    if (!response.ok) {
      throw new Error("Token verification failed")
    }

    const payload = await response.json()

    // Verify the audience (client ID)
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      throw new Error("Invalid audience")
    }

    // Check if token is expired
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired")
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      given_name: payload.given_name,
      family_name: payload.family_name,
      picture: payload.picture,
      verified_email: payload.email_verified,
    }
  } catch (error) {
    console.error("Google token verification error:", error)
    return null
  }
}

export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
