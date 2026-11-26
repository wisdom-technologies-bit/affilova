import { EmailLayout, InfoBox, OrderSummary, Paragraph } from "@/emails/components"
import type { InfoBoxTone } from "@/emails/components"
import type { BrandingUrls } from "@/emails/types"
import { formatNaira } from "@/lib/catalog/money"

// Payouts: the four things that can happen to a withdrawal.
//
// One template and four states, because the shape is the same: what happened,
// the three amounts, and where the money is now. The subject and the heading
// differ, so a person scanning an inbox knows which one arrived without opening
// it, and the tone of the box differs without colour being the only signal: the
// words say it too.

export type WithdrawalNoticeStatus = "paid" | "failed" | "reversed" | "rejected"

export interface WithdrawalNoticeProps {
  status: WithdrawalNoticeStatus
  grossKobo: number | bigint
  feeKobo: number | bigint
  netKobo: number | bigint
  /** For a rejection: the reason written for the user. Escaped like any text. */
  reason?: string | null
  branding: BrandingUrls
}

interface NoticeCopy {
  subject: string
  heading: string
  lead: string
  closing: string
  tone: InfoBoxTone
  boxTitle: string
}

const COPY: Readonly<Record<WithdrawalNoticeStatus, NoticeCopy>> = {
  paid: {
    subject: "Your withdrawal was paid",
    heading: "Your withdrawal was paid",
    lead: "The transfer to your payout account has been sent.",
    closing: "How soon it shows in your account depends on your bank.",
    tone: "success",
    boxTitle: "Sent",
  },
  failed: {
    subject: "Your withdrawal did not go through",
    heading: "Your withdrawal did not go through",
    lead: "The transfer could not be completed.",
    closing: "The full amount is back in your available balance. You can request it again.",
    tone: "warning",
    boxTitle: "Back in your balance",
  },
  reversed: {
    subject: "Your withdrawal was reversed",
    heading: "Your withdrawal was reversed",
    lead: "The transfer was sent back before it reached your account.",
    closing: "The full amount is back in your available balance. You can request it again.",
    tone: "warning",
    boxTitle: "Back in your balance",
  },
  rejected: {
    subject: "Your withdrawal was not approved",
    heading: "Your withdrawal was not approved",
    lead: "We reviewed this request and did not approve it.",
    closing: "The full amount is back in your available balance.",
    tone: "danger",
    boxTitle: "Not approved",
  },
}

export function withdrawalNoticeSubject(status: WithdrawalNoticeStatus): string {
  return COPY[status].subject
}

export function WithdrawalNotice(props: WithdrawalNoticeProps) {
  const copy = COPY[props.status]
  const reason = props.status === "rejected" && props.reason !== null && props.reason !== undefined
    ? props.reason.trim()
    : ""

  return (
    <EmailLayout
      branding={props.branding}
      heading={copy.heading}
      previewText={copy.lead}
      reason="You are receiving this because you requested a withdrawal from your Affilova balance."
    >
      <Paragraph>{copy.lead}</Paragraph>

      <OrderSummary
        rows={[
          { label: "Amount", value: formatNaira(props.grossKobo) },
          { label: "Fee", value: formatNaira(props.feeKobo) },
          { label: "You receive", value: formatNaira(props.netKobo) },
        ]}
      />

      <InfoBox tone={copy.tone} title={copy.boxTitle}>
        {reason === "" ? copy.closing : `Reason: ${reason}. ${copy.closing}`}
      </InfoBox>

      <Paragraph>Your account number is never included in our emails.</Paragraph>
    </EmailLayout>
  )
}

export const withdrawalNoticeSample: WithdrawalNoticeProps = {
  status: "paid",
  grossKobo: 500_000,
  feeKobo: 10_000,
  netKobo: 490_000,
  reason: null,
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
}

/** The four states, for the style guide: every one of them is a message. */
export const withdrawalNoticeSamples: readonly WithdrawalNoticeProps[] = [
  withdrawalNoticeSample,
  { ...withdrawalNoticeSample, status: "failed" },
  { ...withdrawalNoticeSample, status: "reversed" },
  {
    ...withdrawalNoticeSample,
    status: "rejected",
    reason: "The account name did not match the name on your Affilova account.",
  },
]
