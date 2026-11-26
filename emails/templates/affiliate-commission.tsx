import { EmailLayout, InfoBox, OrderSummary, Paragraph } from "@/emails/components"
import { subjectWithTitle } from "@/emails/subject"
import type { BrandingUrls } from "@/emails/types"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Affiliate: a commission, earned by a link that led to a sale.
//
// The same privacy rule as the vendor's message: the buyer is never named, and
// the commission is stated as held until a date rather than as money available.

export interface AffiliateCommissionProps {
  orderNumber: string
  productTitle: string
  commissionKobo: number
  /** ISO instant the held commission becomes withdrawable. */
  heldUntil: string
  branding: BrandingUrls
}

export function affiliateCommissionSubject(props: AffiliateCommissionProps): string {
  return subjectWithTitle("Commission earned: ", props.productTitle)
}

export function AffiliateCommission(props: AffiliateCommissionProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="You earned a commission"
      previewText={`${formatNaira(props.commissionKobo)} for ${props.productTitle}`}
      reason="You are receiving this because your affiliate link led to a sale on Affilova."
    >
      <Paragraph>
        Your link led to a sale of <strong>{props.productTitle}</strong> on order{" "}
        <strong>{props.orderNumber}</strong>.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Commission", value: formatNaira(props.commissionKobo) },
          { label: "Available to withdraw", value: `${formatLagosDateTime(props.heldUntil)} (West Africa Time)` },
          { label: "Order", value: props.orderNumber },
        ]}
        footnote="It is held until the date above, then it can be withdrawn."
      />

      <InfoBox title="Privacy">
        The buyer's details are not included in this email. Every commission is listed on your
        affiliate dashboard.
      </InfoBox>
    </EmailLayout>
  )
}

export const affiliateCommissionSample: AffiliateCommissionProps = {
  orderNumber: "AFV-2026-000142",
  productTitle: "Instagram Growth Playbook",
  commissionKobo: 500_000,
  heldUntil: "2026-11-25T10:00:00.000Z",
  branding: { siteUrl: "https://affiliates.affilova.example", contactUrl: "https://affilova.example/contact" },
}
