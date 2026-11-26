import { EmailLayout, InfoBox, OrderSummary, Paragraph } from "@/emails/components"
import { subjectWithTitle } from "@/emails/subject"
import type { BrandingUrls } from "@/emails/types"
import { formatNaira } from "@/lib/catalog/money"

// Buyer: the refund, once it has been issued.
//
// It says what happened, how much, and the one thing we cannot promise: how long
// a bank takes. It also says the downloads have stopped, because a buyer who
// tries the link and finds it closed should have been told here first.

export interface RefundNoticeProps {
  orderNumber: string
  productTitle: string
  amountKobo: number
  branding: BrandingUrls
}

export function refundNoticeSubject(props: RefundNoticeProps): string {
  return subjectWithTitle("Refund issued: ", props.productTitle)
}

export function RefundNotice(props: RefundNoticeProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="Your refund was issued"
      previewText={`${formatNaira(props.amountKobo)} refunded for ${props.productTitle}`}
      reason="You are receiving this because you bought this product on Affilova and it was refunded."
    >
      <Paragraph>
        Order <strong>{props.orderNumber}</strong> for <strong>{props.productTitle}</strong> was
        refunded.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Amount refunded", value: formatNaira(props.amountKobo) },
          { label: "Product", value: props.productTitle },
          { label: "Order", value: props.orderNumber },
        ]}
      />

      <InfoBox tone="warning" title="When the money arrives">
        The money goes back to the account you paid with. How long it takes depends on that bank, not
        on us.
      </InfoBox>

      <Paragraph>Downloads for this order are no longer available.</Paragraph>
      <Paragraph>If you did not ask for this refund, contact us using the address below.</Paragraph>
    </EmailLayout>
  )
}

export const refundNoticeSample: RefundNoticeProps = {
  orderNumber: "AFV-2026-000142",
  productTitle: "Instagram Growth Playbook",
  amountKobo: 2_500_000,
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
}
