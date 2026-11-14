import { type NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { sql } from "@/lib/db"
import { generateLongAlphanumericId } from "@/lib/utils"
import { brevoService } from "@/lib/brevo"
import { z } from "zod"

const createTicketSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  subject: z.string().min(1),
  category: z.string().min(1),
  message: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validatedData = createTicketSchema.parse(body)

    // Generate unique ticket ID
    const ticketId = generateLongAlphanumericId()

    // Create support ticket
    const [ticket] = await sql`
      INSERT INTO support_tickets (
        alphanumeric_id, name, email, subject, category, message, priority, status
      )
      VALUES (
        ${ticketId}, ${validatedData.name}, ${validatedData.email},
        ${validatedData.subject}, ${validatedData.category}, ${validatedData.message},
        ${validatedData.priority}, 'open'
      )
      RETURNING alphanumeric_id, created_at
    `

    // Send confirmation email to user
    await brevoService.sendEmail({
      to: [{ email: validatedData.email, name: validatedData.name }],
      subject: `Support Ticket Created - #${ticketId}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">Support Ticket Created</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${validatedData.name},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">
          Thank you for contacting Affilova support. We've received your message and created ticket #${ticketId}.
        </p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Ticket ID:</strong> #${ticketId}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Subject:</strong> ${validatedData.subject}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Category:</strong> ${validatedData.category}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Priority:</strong> ${validatedData.priority}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">
          Our support team will review your request and respond within 24 hours. You can reference this ticket using ID #${ticketId}.
        </p>
        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 0; font-size: 14px; color: #065f46;">
            <strong>Need immediate help?</strong> Check our FAQ section or help documentation for quick answers to common questions.
          </p>
        </div>
      `,
    })

    // Send notification to admin
    await brevoService.sendEmail({
      to: [{ email: "wisdommeremeze@gmail.com", name: "Admin" }],
      subject: `New Support Ticket - #${ticketId}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">New Support Ticket</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">A new support ticket has been created:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Ticket ID:</strong> #${ticketId}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>From:</strong> ${validatedData.name} (${validatedData.email})</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Subject:</strong> ${validatedData.subject}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Category:</strong> ${validatedData.category}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Priority:</strong> ${validatedData.priority}</p>
        </div>
        <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #374151;"><strong>Message:</strong></p>
          <p style="margin: 10px 0 0 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${validatedData.message}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/admin" 
             style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            View in Admin Dashboard
          </a>
        </div>
      `,
    })

    return NextResponse.json({
      success: true,
      ticketId: ticketId,
      message: "Support ticket created successfully",
    })
  } catch (error) {
    console.error("Create support ticket error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Failed to create support ticket" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // Every ticket carries the name and email address of the person who opened
  // it, so the list is staff only.
  const auth = await requireRole(["admin"])

  if (!auth.ok) {
    return auth.status === 401
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "all"

    let whereClause = ""
    if (status !== "all") {
      whereClause = `WHERE status = '${status}'`
    }

    const tickets = await sql`
      SELECT alphanumeric_id, name, email, subject, category, priority, status, created_at
      FROM support_tickets
      ${status !== "all" ? sql`WHERE status = ${status}` : sql``}
      ORDER BY 
        CASE priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
        END,
        created_at DESC
    `

    return NextResponse.json({ tickets })
  } catch (error) {
    console.error("Get support tickets error:", error)
    return NextResponse.json({ error: "Failed to fetch support tickets" }, { status: 500 })
  }
}
