"use server"

import { headers } from "next/headers"

import { defaultResendDeps, resendAccessLinks, RESEND_NEUTRAL } from "@/lib/commerce/resend"

// The resend form's one action.
//
// It answers the same sentence for every outcome. The only way to tell that
// nothing was sent is to notice that no email arrived, which is exactly the
// information an attacker should not be able to get from a response.

export interface ResendActionResult {
  ok: boolean
  message: string
}

export async function resendAccessAction(input: {
  email: string
  turnstileToken: string
}): Promise<ResendActionResult> {
  const requestHeaders = await headers()

  try {
    const result = await resendAccessLinks(
      {
        email: typeof input?.email === "string" ? input.email : "",
        turnstileToken: typeof input?.turnstileToken === "string" ? input.turnstileToken : "",
        ip: (await import("@/lib/commerce/resend")).resendClientIp(requestHeaders),
      },
      defaultResendDeps(),
    )

    return { ok: true, message: result.message }
  } catch {
    return { ok: true, message: RESEND_NEUTRAL }
  }
}
