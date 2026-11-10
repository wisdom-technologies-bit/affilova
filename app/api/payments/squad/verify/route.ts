import { type NextRequest, NextResponse } from "next/server"
import { squadService } from "@/lib/squad"
import { getSession } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { transaction_ref } = await request.json()

    if (!transaction_ref) {
      return NextResponse.json({ error: "Transaction reference required" }, { status: 400 })
    }

    const verification = await squadService.verifyTransaction(transaction_ref)

    return NextResponse.json(verification)
  } catch (error) {
    console.error("Payment verification error:", error)
    return NextResponse.json({ error: "Verification failed" }, { status: 500 })
  }
}
