import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { brevoService } from "@/lib/brevo"

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const withdrawalId = params.id

    // Get withdrawal details
    const [withdrawal] = await sql`
      SELECT 
        w.*,
        u.first_name || ' ' || u.last_name as user_name,
        u.email as user_email
      FROM withdrawal_requests w
      JOIN users u ON w.user_id = u.id
      WHERE w.alphanumeric_id = ${withdrawalId}
    `

    if (!withdrawal) {
      return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 })
    }

    // Approve the withdrawal
    await sql`
      UPDATE withdrawal_requests 
      SET status = 'approved', updated_at = CURRENT_TIMESTAMP
      WHERE alphanumeric_id = ${withdrawalId}
    `

    // Send approval email
    if (withdrawal.user_email) {
      await brevoService.sendEmail({
        to: [{ email: withdrawal.user_email, name: withdrawal.user_name }],
        subject: `Withdrawal Approved - ₦${(withdrawal.amount / 100).toLocaleString()}`,
        htmlContent: `
          <h1 style="color: #22c55e; margin-bottom: 20px;">Withdrawal Approved!</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${withdrawal.user_name},</p>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            Great news! Your withdrawal request has been approved and will be processed within 1-3 business days.
          </p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Amount:</strong> ₦${(withdrawal.amount / 100).toLocaleString()}</p>
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Request Date:</strong> ${new Date(withdrawal.created_at).toLocaleDateString()}</p>
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Status:</strong> Approved</p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            The funds will be transferred to your registered bank account. You'll receive a confirmation once the transfer is complete.
          </p>
        `,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Approve withdrawal error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
