import { EmailLayout, InfoBox, OrderSummary, Paragraph } from "@/emails/components"
import { subjectWithTitle } from "@/emails/subject"
import type { BrandingUrls } from "@/emails/types"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Vendor: a sale.
//
// Two numbers, the sale and the vendor's share, and the date the share can be
// withdrawn. The buyer is never in this message: not an address, not a name, not
// an order of initials. A vendor sees their own money and nothing about the
// person who paid.

export interface VendorSaleProps {
  orderNumber: string
  productTitle: string
  amountKobo: number
  vendorNetKobo: number
  /** ISO instant the held amount becomes withdrawable. */
  heldUntil: string
  branding: BrandingUrls
}

export function vendorSaleSubject(props: VendorSaleProps): string {
  return subjectWithTitle("You made a sale: ", props.productTitle)
}

export function VendorSale(props: VendorSaleProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="You made a sale"
      previewText={`${props.productTitle} sold`}
      reason="You are receiving this because you sell on Affilova."
    >
      <Paragraph>
        <strong>{props.productTitle}</strong> sold on order <strong>{props.orderNumber}</strong>.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Sale amount", value: formatNaira(props.amountKobo) },
          { label: "Your share", value: formatNaira(props.vendorNetKobo) },
          { label: "Available to withdraw", value: `${formatLagosDateTime(props.heldUntil)} (West Africa Time)` },
          { label: "Order", value: props.orderNumber },
        ]}
        footnote="Your share is held until the date above, then it can be withdrawn."
      />

      <InfoBox title="Privacy">
        The buyer's details are not included in this email. Your balance and every sale are on your
        dashboard.
      </InfoBox>
    </EmailLayout>
  )
}

export const vendorSaleSample: VendorSaleProps = {
  orderNumber: "AFV-2026-000142",
  productTitle: "Instagram Growth Playbook",
  amountKobo: 2_500_000,
  vendorNetKobo: 2_000_000,
  heldUntil: "2026-11-25T10:00:00.000Z",
  branding: { siteUrl: "https://merchants.affilova.example", contactUrl: "https://affilova.example/contact" },
}
