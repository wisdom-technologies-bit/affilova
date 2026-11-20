// The four transactional emails, as HTML and as text.
//
// Rules that hold for every template here:
//   * every value that came from a person or a vendor is escaped: a product
//     title is a string a vendor typed, not markup;
//   * the HTML is a single column of tables-free blocks with inline styles, so it
//     renders in a mail client that strips a stylesheet;
//   * the one button is brand green (#107F3E) with white text;
//   * there is no tracking pixel, no remote image other than the logo, and no
//     claim the platform cannot keep.

import { formatLagosDateTime } from "@/lib/catalog/format"
import { formatNaira } from "@/lib/catalog/money"

export interface EmailContent {
  subject: string
  html: string
  text: string
}

/** Escape text for an HTML context, including quotes inside attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** The absolute URL of the logo in the email header. */
export const EMAIL_LOGO_PATH = "/brand/email/affilova-logo-email.png"

const BUTTON_BACKGROUND = "#107F3E"

const BODY_STYLE =
  "margin:0;padding:24px;background:#f6f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111111;"

const CARD_STYLE =
  "max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;"

const HEADING_STYLE = "margin:0 0 12px 0;font-size:20px;line-height:1.3;color:#111111;"

const PARAGRAPH_STYLE = "margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#222222;"

const MUTED_STYLE = "margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#4b5563;"

const BUTTON_STYLE = [
  "display:inline-block",
  "padding:12px 20px",
  "border-radius:6px",
  `background:${BUTTON_BACKGROUND}`,
  "color:#ffffff",
  "font-size:15px",
  "font-weight:600",
  "text-decoration:none",
].join(";")

export interface BrandingUrls {
  /** Absolute public site URL, for the logo and the links. */
  siteUrl: string
  /** Absolute contact page URL. */
  contactUrl: string
}

function layout(input: {
  branding: BrandingUrls
  heading: string
  paragraphs: readonly string[]
  button?: { label: string; url: string }
  footnote: string
}): string {
  const logo = `${input.branding.siteUrl.replace(/\/+$/, "")}${EMAIL_LOGO_PATH}`

  const body = input.paragraphs
    .map((paragraph) => `<p style="${PARAGRAPH_STYLE}">${paragraph}</p>`)
    .join("")

  const button =
    input.button === undefined
      ? ""
      : `<p style="margin:0 0 16px 0;"><a href="${escapeHtml(input.button.url)}" style="${BUTTON_STYLE}">${escapeHtml(input.button.label)}</a></p>`

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${BODY_STYLE}">
  <div style="${CARD_STYLE}">
    <p style="margin:0 0 20px 0;"><img src="${escapeHtml(logo)}" alt="Affilova" width="140" style="display:block;border:0;max-width:140px;height:auto;"></p>
    <h1 style="${HEADING_STYLE}">${escapeHtml(input.heading)}</h1>
    ${body}
    ${button}
    <p style="${MUTED_STYLE}">${input.footnote}</p>
    <p style="${MUTED_STYLE}">Questions? Contact us through our <a href="${escapeHtml(input.branding.contactUrl)}" style="color:${BUTTON_BACKGROUND};">contact page</a>.</p>
  </div>
</body>
</html>`
}

function textLines(lines: readonly string[]): string {
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Buyer: receipt and access link
// ---------------------------------------------------------------------------

export interface PurchaseReceiptInput {
  orderNumber: string
  productTitle: string
  amountKobo: number
  paidAt: string
  accessUrl: string
  refundWindowHours: number
  branding: BrandingUrls
}

export function purchaseReceiptEmail(input: PurchaseReceiptInput): EmailContent {
  const amount = formatNaira(input.amountKobo)
  const date = formatLagosDateTime(input.paidAt)

  return {
    subject: `Your download link: ${input.productTitle}`,
    html: layout({
      branding: input.branding,
      heading: "Payment received",
      paragraphs: [
        `Order <strong>${escapeHtml(input.orderNumber)}</strong> for <strong>${escapeHtml(input.productTitle)}</strong> is paid.`,
        `Amount: <strong>${escapeHtml(amount)}</strong><br>Date: ${escapeHtml(date)} (West Africa Time).`,
        `Refunds: ${escapeHtml(`requests are accepted within ${input.refundWindowHours} hours of purchase`)}. The download page has the request form while the window is open.`,
        "Keep this email: the link below opens your downloads.",
      ],
      button: { label: "Open your downloads", url: input.accessUrl },
      footnote:
        "The link is personal to this order. If you forward it, whoever opens it can download your files.",
    }),
    text: textLines([
      "Payment received",
      "",
      `Order: ${input.orderNumber}`,
      `Product: ${input.productTitle}`,
      `Amount: ${amount}`,
      `Date: ${date} (West Africa Time)`,
      "",
      `Downloads: ${input.accessUrl}`,
      "",
      `Refunds: requests are accepted within ${input.refundWindowHours} hours of purchase.`,
      "",
      "The link is personal to this order. If you forward it, whoever opens it can download your files.",
      "",
      "Questions? Contact us through our contact page:",
      input.branding.contactUrl,
    ]),
  }
}

// ---------------------------------------------------------------------------
// Vendor: a sale
// ---------------------------------------------------------------------------

export interface VendorSaleInput {
  orderNumber: string
  productTitle: string
  amountKobo: number
  vendorNetKobo: number
  /** ISO date the held amount becomes withdrawable. */
  heldUntil: string
  branding: BrandingUrls
}

export function vendorSaleEmail(input: VendorSaleInput): EmailContent {
  const amount = formatNaira(input.amountKobo)
  const net = formatNaira(input.vendorNetKobo)
  const heldUntil = formatLagosDateTime(input.heldUntil)

  return {
    subject: `You made a sale: ${input.productTitle}`,
    html: layout({
      branding: input.branding,
      heading: "You made a sale",
      paragraphs: [
        `<strong>${escapeHtml(input.productTitle)}</strong> sold on order <strong>${escapeHtml(input.orderNumber)}</strong>.`,
        `Sale amount: <strong>${escapeHtml(amount)}</strong><br>Your share: <strong>${escapeHtml(net)}</strong>`,
        `Your share is held until ${escapeHtml(heldUntil)} (West Africa Time), then it can be withdrawn.`,
        "The buyer's details are not included in this email.",
      ],
      footnote: "Your balance and every sale are on your dashboard.",
    }),
    text: textLines([
      "You made a sale",
      "",
      `Product: ${input.productTitle}`,
      `Order: ${input.orderNumber}`,
      `Sale amount: ${amount}`,
      `Your share: ${net}`,
      `Held until: ${heldUntil} (West Africa Time)`,
      "",
      "The buyer's details are not included in this email.",
      "",
      "Questions? Contact us through our contact page:",
      input.branding.contactUrl,
    ]),
  }
}

// ---------------------------------------------------------------------------
// Affiliate: a commission
// ---------------------------------------------------------------------------

export interface AffiliateCommissionInput {
  orderNumber: string
  productTitle: string
  commissionKobo: number
  heldUntil: string
  branding: BrandingUrls
}

export function affiliateCommissionEmail(input: AffiliateCommissionInput): EmailContent {
  const commission = formatNaira(input.commissionKobo)
  const heldUntil = formatLagosDateTime(input.heldUntil)

  return {
    subject: `Commission earned: ${input.productTitle}`,
    html: layout({
      branding: input.branding,
      heading: "You earned a commission",
      paragraphs: [
        `Your link led to a sale of <strong>${escapeHtml(input.productTitle)}</strong> on order <strong>${escapeHtml(input.orderNumber)}</strong>.`,
        `Commission: <strong>${escapeHtml(commission)}</strong>`,
        `It is held until ${escapeHtml(heldUntil)} (West Africa Time), then it can be withdrawn.`,
        "The buyer's details are not included in this email.",
      ],
      footnote: "Every commission is listed on your affiliate dashboard.",
    }),
    text: textLines([
      "You earned a commission",
      "",
      `Product: ${input.productTitle}`,
      `Order: ${input.orderNumber}`,
      `Commission: ${commission}`,
      `Held until: ${heldUntil} (West Africa Time)`,
      "",
      "The buyer's details are not included in this email.",
      "",
      "Questions? Contact us through our contact page:",
      input.branding.contactUrl,
    ]),
  }
}

// ---------------------------------------------------------------------------
// Buyer: refund
// ---------------------------------------------------------------------------

export interface RefundNoticeInput {
  orderNumber: string
  productTitle: string
  amountKobo: number
  branding: BrandingUrls
}

export function refundNoticeEmail(input: RefundNoticeInput): EmailContent {
  const amount = formatNaira(input.amountKobo)

  return {
    subject: `Refund issued: ${input.productTitle}`,
    html: layout({
      branding: input.branding,
      heading: "Your refund was issued",
      paragraphs: [
        `Order <strong>${escapeHtml(input.orderNumber)}</strong> for <strong>${escapeHtml(input.productTitle)}</strong> was refunded.`,
        `Amount refunded: <strong>${escapeHtml(amount)}</strong>`,
        "The money goes back to the account you paid with. How long it takes depends on that bank, not on us.",
        "Downloads for this order are no longer available.",
      ],
      footnote: "If you did not ask for this refund, contact us through the contact page below.",
    }),
    text: textLines([
      "Your refund was issued",
      "",
      `Order: ${input.orderNumber}`,
      `Product: ${input.productTitle}`,
      `Amount refunded: ${amount}`,
      "",
      "The money goes back to the account you paid with. How long it takes depends on that bank, not on us.",
      "Downloads for this order are no longer available.",
      "",
      "If you did not ask for this refund, contact us through our contact page:",
      input.branding.contactUrl,
    ]),
  }
}
