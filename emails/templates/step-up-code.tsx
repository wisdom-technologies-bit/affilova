import { Code, EmailLayout, Paragraph } from "@/emails/components"
import type { BrandingUrls } from "@/emails/types"

// Payouts: the step-up code.
//
// The code is the whole message, so it is the largest thing in it. Two sentences
// surround it: what it is for, and that it works once and expires. The code is
// never a link: a link would be clickable by whoever reads the inbox.

export type StepUpPurpose = "bank_change" | "withdrawal"

export interface StepUpCodeProps {
  /** Six digits. Rendered as given: the caller has already validated it. */
  code: string
  purpose: StepUpPurpose
  expiresInMinutes: number
  branding: BrandingUrls
}

const ACTION: Readonly<Record<StepUpPurpose, string>> = {
  bank_change: "change your payout account",
  withdrawal: "request a withdrawal",
}

export const STEP_UP_CODE_SUBJECT = "Your Affilova confirmation code"

export function stepUpCodeSubject(): string {
  return STEP_UP_CODE_SUBJECT
}

export function StepUpCode(props: StepUpCodeProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="Your confirmation code"
      previewText={`Your code expires in ${props.expiresInMinutes} minutes`}
      reason="You are receiving this because a confirmation code was requested for your Affilova account."
    >
      <Paragraph>Use this code to {ACTION[props.purpose]}:</Paragraph>

      <Code code={props.code} label="Your code" />

      <Paragraph>
        It expires in {props.expiresInMinutes} minutes and works once. We will never ask you to read it
        out to anyone.
      </Paragraph>

      <Paragraph>If you did not request this, change your password and contact us.</Paragraph>
    </EmailLayout>
  )
}

export const stepUpCodeSample: StepUpCodeProps = {
  code: "004821",
  purpose: "withdrawal",
  expiresInMinutes: 10,
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
}
