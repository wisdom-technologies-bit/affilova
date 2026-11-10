import { NextResponse } from "next/server"
import { squadService } from "@/lib/squad"

export async function GET() {
  return NextResponse.json({
    publicKey: squadService.getPublicKey(),
  })
}
