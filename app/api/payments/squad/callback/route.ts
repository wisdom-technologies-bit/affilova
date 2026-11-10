import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { squadService } from "@/lib/squad"
import { brevoService } from "@/lib/brevo"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transaction_ref, status, gateway_transaction_ref } = body

    console.log("Squad webhook received:", body)

    // Verify transaction with Squad
    const verification = await squadService.verifyTransaction(transaction_ref)

    if (!verification.success) {
      console.error("Transaction verification failed:", verification.message)
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    // Find the transaction in our database
    const [transaction] = await sql`
      SELECT t.*, p.title as product_title, p.vendor_id,
             u.email as customer_email, u.first_name as customer_name,
             v.user_id as vendor_user_id, vu.email as vendor_email, vu.first_name as vendor_name,
             a.user_id as affiliate_user_id, au.email as affiliate_email, au.first_name as affiliate_name
      FROM transactions t
      LEFT JOIN products p ON t.product_id = p.id
      LEFT JOIN users u ON t.customer_email = u.email
      LEFT JOIN vendors v ON t.vendor_id = v.id
      LEFT JOIN users vu ON v.user_id = vu.id
      LEFT JOIN affiliates a ON t.affiliate_id = a.id
      LEFT JOIN users au ON a.user_id = au.id
      WHERE t.id = ${transaction_ref} OR t.payment_reference = ${transaction_ref}
    `

    if (!transaction) {
      console.error("Transaction not found:", transaction_ref)
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
    }

    // Update transaction status
    const paymentStatus = verification.data.transaction_status === "success" ? "completed" : "failed"

    await sql`
      UPDATE transactions 
      SET payment_status = ${paymentStatus}, 
          gateway_reference = ${gateway_transaction_ref},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${transaction.id}
    `

    if (paymentStatus === "completed") {
      // Generate receipt
      const receiptNumber = await sql`SELECT generate_receipt_number() as number`

      await sql`
        INSERT INTO receipts (transaction_id, receipt_number)
        VALUES (${transaction.id}, ${receiptNumber[0].number})
      `

      // Send success emails
      if (transaction.vendor_email) {
        await brevoService.sendEmail({
          to: [{ email: transaction.vendor_email, name: transaction.vendor_name }],
          subject: `New Sale - ${transaction.product_title}`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; padding: 20px;">
                <img src="${process.env.NEXT_PUBLIC_APP_URL}/affilova-logo.png" alt="Affilova" style="height: 60px;">
              </div>
              <h1 style="color: #22c55e;">New Sale Notification!</h1>
              <p>Hi ${transaction.vendor_name},</p>
              <p>Great news! You've made a new sale:</p>
              <ul>
                <li><strong>Product:</strong> ${transaction.product_title}</li>
                <li><strong>Amount:</strong> ₦${(transaction.amount / 100).toLocaleString()}</li>
                <li><strong>Customer:</strong> ${transaction.customer_name}</li>
                ${transaction.affiliate_name ? `<li><strong>Affiliate:</strong> ${transaction.affiliate_name}</li>` : ""}
              </ul>
              <p>Your payout will be processed on the next Thursday.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="text-align: center; color: #666; font-size: 12px;">
                Powered by Wisdom Technologies®
              </p>
            </div>
          `,
        })
      }

      if (transaction.affiliate_email) {
        await brevoService.sendEmail({
          to: [{ email: transaction.affiliate_email, name: transaction.affiliate_name }],
          subject: `Commission Earned - ${transaction.product_title}`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; padding: 20px;">
                <img src="${process.env.NEXT_PUBLIC_APP_URL}/affilova-logo.png" alt="Affilova" style="height: 60px;">
              </div>
              <h1 style="color: #22c55e;">Commission Earned!</h1>
              <p>Hi ${transaction.affiliate_name},</p>
              <p>Congratulations! You've earned a commission:</p>
              <ul>
                <li><strong>Product:</strong> ${transaction.product_title}</li>
                <li><strong>Sale Amount:</strong> ₦${(transaction.amount / 100).toLocaleString()}</li>
                <li><strong>Your Commission:</strong> ₦${(transaction.affiliate_commission / 100).toLocaleString()}</li>
              </ul>
              <p>Your commission will be paid on the next Thursday.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="text-align: center; color: #666; font-size: 12px;">
                Powered by Wisdom Technologies®
              </p>
            </div>
          `,
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Squad webhook error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

// Handle GET requests for webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const challenge = searchParams.get("challenge")

  if (challenge) {
    return NextResponse.json({ challenge })
  }

  return NextResponse.json({ status: "Webhook endpoint active" })
}
