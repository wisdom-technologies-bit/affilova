import { type NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { z } from "zod"

const paymentInfoSchema = z.object({
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  bankCode: z.string().optional(),
})

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "vendor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = paymentInfoSchema.parse(body)

    // Check if bank account exists
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update payment info error:", error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payment data", details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
