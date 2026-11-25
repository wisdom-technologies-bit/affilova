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

// ---------------------------------------------------------------------------
// Payouts: the step-up code and the withdrawal notices
// ---------------------------------------------------------------------------

export interface StepUpCodeInput {
  /** Six digits. Rendered as given: the caller has already validated it. */
  code: string
  purpose: "bank_change" | "withdrawal"
  expiresInMinutes: number
  branding: BrandingUrls
}

const STEP_UP_ACTION: Readonly<Record<StepUpCodeInput["purpose"], string>> = {
  bank_change: "change your payout account",
  withdrawal: "request a withdrawal",
}

export function stepUpCodeEmail(input: StepUpCodeInput): EmailContent {
  const action = STEP_UP_ACTION[input.purpose]
  const minutes = `${input.expiresInMinutes} minutes`

  return {
    subject: "Your Affilova confirmation code",
    html: layout({
      branding: input.branding,
      heading: "Your confirmation code",
      paragraphs: [
        `Use this code to ${escapeHtml(action)}:`,
        `<span style="display:inline-block;font-size:28px;letter-spacing:6px;font-weight:700;font-family:'Courier New',monospace;">${escapeHtml(input.code)}</span>`,
        `It expires in ${escapeHtml(minutes)} and works once. We will never ask you to read it out to anyone.`,
      ],
      footnote: "If you did not request this, change your password and contact us.",
    }),
    text: textLines([
      "Your confirmation code",
      "",
      `Use this code to ${action}:`,
      input.code,
      "",
      `It expires in ${minutes} and works once. We will never ask you to read it out to anyone.`,
      "",
      "If you did not request this, change your password and contact us.",
      input.branding.contactUrl,
    ]),
  }
}

export type WithdrawalNoticeStatus = "paid" | "failed" | "reversed" | "rejected"

export interface WithdrawalNoticeInput {
  status: WithdrawalNoticeStatus
  grossKobo: number | bigint
  feeKobo: number | bigint
  netKobo: number | bigint
  /** For a rejection: the reason written for the user. Escaped like any text. */
  reason?: string | null
  branding: BrandingUrls
}

const NOTICE_COPY: Readonly<
  Record<WithdrawalNoticeStatus, { subject: string; heading: string; lead: string; closing: string }>
> = {
  paid: {
    subject: "Your withdrawal was paid",
    heading: "Your withdrawal was paid",
    lead: "The transfer to your payout account has been sent.",
    closing: "How soon it shows in your account depends on your bank.",
  },
  failed: {
    subject: "Your withdrawal did not go through",
    heading: "Your withdrawal did not go through",
    lead: "The transfer could not be completed.",
    closing: "The full amount is back in your available balance. You can request it again.",
  },
  reversed: {
    subject: "Your withdrawal was reversed",
    heading: "Your withdrawal was reversed",
    lead: "The transfer was sent back before it reached your account.",
    closing: "The full amount is back in your available balance. You can request it again.",
  },
  rejected: {
    subject: "Your withdrawal was not approved",
    heading: "Your withdrawal was not approved",
    lead: "We reviewed this request and did not approve it.",
    closing: "The full amount is back in your available balance.",
  },
}

export function withdrawalNoticeEmail(input: WithdrawalNoticeInput): EmailContent {
  const copy = NOTICE_COPY[input.status]
  const gross = formatNaira(input.grossKobo)
  const fee = formatNaira(input.feeKobo)
  const net = formatNaira(input.netKobo)
  const reason = input.status === "rejected" && input.reason ? input.reason.trim() : ""

  const paragraphs = [
    copy.lead,
    `Amount: <strong>${escapeHtml(gross)}</strong><br>Fee: <strong>${escapeHtml(fee)}</strong><br>You receive: <strong>${escapeHtml(net)}</strong>`,
    ...(reason === "" ? [] : [`Reason: ${escapeHtml(reason)}`]),
    copy.closing,
  ]

  return {
    subject: copy.subject,
    html: layout({
      branding: input.branding,
      heading: copy.heading,
      paragraphs,
      footnote: "Your account number is never included in our emails.",
    }),
    text: textLines([
      copy.heading,
      "",
      copy.lead,
      "",
      `Amount: ${gross}`,
      `Fee: ${fee}`,
      `You receive: ${net}`,
      ...(reason === "" ? [] : ["", `Reason: ${reason}`]),
      "",
      copy.closing,
      "",
      "Questions? Contact us through our contact page:",
      input.branding.contactUrl,
    ]),
  }
}

// ---------------------------------------------------------------------------
// Staff: the VAT reminder
// ---------------------------------------------------------------------------

export interface VatReminderInput {
  /** The month the return is for, already written for a person: "September 2026". */
  periodLabel: string
  /** The day it is due, already written in Lagos time. */
  dueDate: string
  netPayableKobo: number | bigint
  reminder: "due_soon" | "overdue"
  /** The absolute address of the VAT screen on the admin host. */
  vatUrl: string
  branding: BrandingUrls
}

export function vatReminderEmail(input: VatReminderInput): EmailContent {
  const amount = formatNaira(input.netPayableKobo)
  const overdue = input.reminder === "overdue"
  const heading = overdue ? "A VAT return is overdue" : "A VAT return is due soon"
  const subject = overdue
    ? `VAT for ${input.periodLabel} is overdue`
    : `VAT for ${input.periodLabel} is due on ${input.dueDate}`

  const paragraphs = [
    `The VAT return for <strong>${escapeHtml(input.periodLabel)}</strong> is due on <strong>${escapeHtml(input.dueDate)}</strong>.`,
    `Net payable: <strong>${escapeHtml(amount)}</strong>`,
    overdue
      ? "The due date has passed. File and pay as soon as you can, then record the payment reference on the VAT screen."
      : "Export the month from the VAT screen, file it with the tax authority, pay, then record the payment reference.",
    "This reminder is only sent to finance and admin accounts, and only once for each month and each reminder.",
  ]

  return {
    subject,
    html: layout({
      branding: input.branding,
      heading,
      paragraphs,
      button: { label: "Open the VAT screen", url: input.vatUrl },
      footnote: "You are receiving this because your account has the finance or admin role.",
    }),
    text: textLines([
      heading,
      "",
      `Period: ${input.periodLabel}`,
      `Due date: ${input.dueDate}`,
      `Net payable: ${amount}`,
      "",
      overdue
        ? "The due date has passed. File and pay as soon as you can, then record the payment reference on the VAT screen."
        : "Export the month from the VAT screen, file it with the tax authority, pay, then record the payment reference.",
      "",
      `Open the VAT screen: ${input.vatUrl}`,
    ]),
  }
}
