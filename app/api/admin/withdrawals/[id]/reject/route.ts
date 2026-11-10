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

    // Reject the withdrawal
    await sql`
      UPDATE withdrawal_requests 
      SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
      WHERE alphanumeric_id = ${withdrawalId}
    `

    // Send rejection email
    if (withdrawal.user_email) {
      await brevoService.sendEmail({
        to: [{ email: withdrawal.user_email, name: withdrawal.user_name }],
        subject: `Withdrawal Rejected - ₦${(withdrawal.amount / 100).toLocaleString()}`,
        htmlContent: `
          <h1 style="color: #ef4444; margin-bottom: 20px;">Withdrawal Rejected</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${withdrawal.user_name},</p>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            We regret to inform you that your withdrawal request has been rejected.
          </p>
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Amount:</strong> ₦${(withdrawal.amount / 100).toLocaleString()}</p>
            <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Request Date:</strong> ${new Date(withdrawal.created_at).toLocaleDateString()}</p>
            <p style="margin: 10px 0 0 0; font-size: 14px; color: #374151;">
              <strong>Common reasons for rejection:</strong><br>
              • Insufficient account balance<br>
              • Invalid bank account details<br>
              • Minimum withdrawal amount not met<br>
              • Account verification required
            </p>
          </div>
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">
            Please contact our support team if you need clarification or assistance with your withdrawal.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/contact" 
               style="background: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
              Contact Support
            </a>
          </div>
        `,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Reject withdrawal error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
