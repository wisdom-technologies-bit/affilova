import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { z } from "zod"

const profileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().optional(),
  experienceLevel: z.string().optional(),
  marketingChannels: z.array(z.string()).optional(),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  socialMediaLinks: z
    .object({
      facebook: z.string().optional(),
      twitter: z.string().optional(),
      instagram: z.string().optional(),
      linkedin: z.string().optional(),
      youtube: z.string().optional(),
    })
    .optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  bankCode: z.string().optional(),
  profilePictureUrl: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user and affiliate data
    const [user] = await sql`
      SELECT u.first_name, u.last_name, u.email, u.company_name, u.profile_picture_url,
             a.experience_level, a.marketing_channels, a.website_url, a.social_media_links
      FROM users u
      LEFT JOIN affiliates a ON u.id = a.user_id
      WHERE u.id = ${session.userId}
    `

    // Get bank account data
    const [bankAccount] = await sql`
      SELECT bank_name, account_number, account_name, bank_code
      FROM user_bank_accounts
      WHERE user_id = ${session.userId}
    `

    const profile = {
      firstName: user?.first_name || "",
      lastName: user?.last_name || "",
      email: user?.email || "",
      companyName: user?.company_name || "",
      experienceLevel: user?.experience_level || "",
      marketingChannels: user?.marketing_channels || [],
      websiteUrl: user?.website_url || "",
      socialMediaLinks: user?.social_media_links || {
        facebook: "",
        twitter: "",
        instagram: "",
        linkedin: "",
        youtube: "",
      },
      avatar: user?.profile_picture_url || "",
      bankName: bankAccount?.bank_name || "",
      accountNumber: bankAccount?.account_number || "",
      accountName: bankAccount?.account_name || "",
      bankCode: bankAccount?.bank_code || "",
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error("Get affiliate profile error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "affiliate") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = profileSchema.parse(body)

    // Update user data
    await sql`
      UPDATE users 
      SET first_name = ${validatedData.firstName},
          last_name = ${validatedData.lastName},
          company_name = ${validatedData.companyName || null},
          profile_picture_url = ${validatedData.profilePictureUrl || null}
      WHERE id = ${session.userId}
    `

    // Update affiliate data
    await sql`
      UPDATE affiliates 
      SET experience_level = ${validatedData.experienceLevel || null},
          marketing_channels = ${validatedData.marketingChannels || []},
          website_url = ${validatedData.websiteUrl || null},
          social_media_links = ${JSON.stringify(validatedData.socialMediaLinks || {})}
      WHERE user_id = ${session.userId}
    `

    // Update or insert bank account data
    if (validatedData.bankName && validatedData.accountNumber && validatedData.accountName) {
      const [existingBankAccount] = await sql`
        SELECT id FROM user_bank_accounts WHERE user_id = ${session.userId}
      `

      if (existingBankAccount) {
        await sql`
          UPDATE user_bank_accounts 
          SET bank_name = ${validatedData.bankName},
              account_number = ${validatedData.accountNumber},
              account_name = ${validatedData.accountName},
              bank_code = ${validatedData.bankCode || null}
          WHERE user_id = ${session.userId}
        `
      } else {
        await sql`
          INSERT INTO user_bank_accounts (user_id, bank_name, account_number, account_name, bank_code)
          VALUES (${session.userId}, ${validatedData.bankName}, ${validatedData.accountNumber}, 
                  ${validatedData.accountName}, ${validatedData.bankCode || null})
        `
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update affiliate profile error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid profile data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
