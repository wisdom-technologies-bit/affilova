import { EmailLayout, InfoBox, OrderSummary, Paragraph, PrimaryButton } from "@/emails/components"
import { subjectWithTitle } from "@/emails/subject"
import type { BrandingUrls } from "@/emails/types"
import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

// Buyer: the receipt, with the link that opens the downloads.
//
// The link is the point of the message, so it is the one button and it is
// printed again underneath. The refund window is stated as a fact and the
// promise is the one the download page can keep: the form is there while the
// window is open.

export interface PurchaseReceiptProps {
  orderNumber: string
  productTitle: string
  amountKobo: number
  /** ISO instant the payment settled. Shown in Lagos time. */
  paidAt: string
  /** Absolute, signed, personal to this order. */
  accessUrl: string
  refundWindowHours: number
  branding: BrandingUrls
}

export function purchaseReceiptSubject(props: PurchaseReceiptProps): string {
  return subjectWithTitle("Your download link: ", props.productTitle)
}

export function PurchaseReceipt(props: PurchaseReceiptProps) {
  return (
    <EmailLayout
      branding={props.branding}
      heading="Payment received"
      previewText={`Your download link for ${props.productTitle}`}
      reason="You are receiving this because you bought this product on Affilova."
    >
      <Paragraph>
        Order <strong>{props.orderNumber}</strong> is paid. The link below opens your downloads.
      </Paragraph>

      <OrderSummary
        rows={[
          { label: "Product", value: props.productTitle },
          { label: "Amount paid", value: formatNaira(props.amountKobo) },
          { label: "Date", value: `${formatLagosDateTime(props.paidAt)} (West Africa Time)` },
          { label: "Order", value: props.orderNumber },
        ]}
      />

      <PrimaryButton href={props.accessUrl} label="Open your downloads" />

      <InfoBox title="Refunds">
        Requests are accepted within {props.refundWindowHours} hours of purchase. The download page has
        the request form while the window is open.
      </InfoBox>

      <Paragraph>
        Keep this email: it is the fastest way back to your downloads, and the link works while the
        order stands.
      </Paragraph>
    </EmailLayout>
  )
}

export const purchaseReceiptSample: PurchaseReceiptProps = {
  orderNumber: "AFV-2026-000142",
  productTitle: "Instagram Growth Playbook",
  amountKobo: 2_500_000,
  paidAt: "2026-11-18T10:00:00.000Z",
  accessUrl: "https://affilova.example/access/token.sig",
  refundWindowHours: 72,
  branding: { siteUrl: "https://affilova.example", contactUrl: "https://affilova.example/contact" },
}
