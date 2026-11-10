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
      SELECT t.*, p.title as product_title, p.vendor_id, p.commission_rate,
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

      // Calculate commissions
      const platformFee = Math.round(transaction.amount * 0.1) // 10% platform fee
      const affiliateCommission = transaction.affiliate_commission || 0
      const vendorPayout = transaction.amount - platformFee - affiliateCommission

      // Send notification to admin
      await brevoService.sendPaymentNotificationToAdmin({
        amount: transaction.amount,
        productTitle: transaction.product_title,
        customerName: transaction.customer_name,
        vendorName: transaction.vendor_name,
        affiliateName: transaction.affiliate_name,
        transactionRef: transaction_ref,
      })

      // Send success emails to vendor
      if (transaction.vendor_email) {
        await brevoService.sendSaleNotificationEmail(transaction.vendor_email, transaction.vendor_name, true, {
          productTitle: transaction.product_title,
          amount: transaction.amount,
          customerName: transaction.customer_name,
          commission: affiliateCommission,
          affiliateName: transaction.affiliate_name,
        })
      }

      // Send success emails to affiliate
      if (transaction.affiliate_email) {
        await brevoService.sendSaleNotificationEmail(transaction.affiliate_email, transaction.affiliate_name, false, {
          productTitle: transaction.product_title,
          amount: transaction.amount,
          customerName: transaction.customer_name,
          commission: affiliateCommission,
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
