// The public email functions, as thin adapters over the React Email templates.
//
// These names, their props and their return shape are what the rest of the app
// calls, and none of that changed when the templates moved to emails/: a caller
// still gets `{ subject, html, text }` from a plain function. What changed is
// inside: the markup is built from React components in emails/, so every message
// shares one layout, one button and one footer.
//
// Escaping is now React's job. A product title, a name or a rejection reason is
// passed as a child and React escapes it, which is stronger than the hand-written
// escaper this file used to carry: it covers attribute contexts too. escapeHtml
// stays exported because it is part of this module's public surface and other
// code may still escape a string before it reaches a template.
//
// Nothing here reads the environment, so the file is safe to import from a test.

import { createElement } from "react"

import { PurchaseReceipt, purchaseReceiptSubject, type PurchaseReceiptProps } from "@/emails/templates/purchase-receipt"
import { VendorSale, vendorSaleSubject, type VendorSaleProps } from "@/emails/templates/vendor-sale"
import {
  AffiliateCommission,
  affiliateCommissionSubject,
  type AffiliateCommissionProps,
} from "@/emails/templates/affiliate-commission"
import { RefundNotice, refundNoticeSubject, type RefundNoticeProps } from "@/emails/templates/refund-notice"
import { StepUpCode, stepUpCodeSubject, type StepUpCodeProps } from "@/emails/templates/step-up-code"
import {
  WithdrawalNotice,
  withdrawalNoticeSubject,
  type WithdrawalNoticeProps,
} from "@/emails/templates/withdrawal-notice"
import { VatReminder, vatReminderSubject, type VatReminderProps } from "@/emails/templates/vat-reminder"
import { SystemTest, systemTestSubject, type SystemTestProps } from "@/emails/templates/system-test"
import { EMAIL_LOGO_PATH } from "@/emails/components/email-layout"
import { renderEmail } from "@/emails/render"
import type { BrandingUrls, RenderedEmail } from "@/emails/types"

export type { BrandingUrls } from "@/emails/types"
export type { StepUpPurpose } from "@/emails/templates/step-up-code"
export type { VatReminderKind } from "@/emails/templates/vat-reminder"
export type { WithdrawalNoticeStatus } from "@/emails/templates/withdrawal-notice"

/** One rendered message: what sendEmail() posts to Brevo. */
export type EmailContent = RenderedEmail

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
export { EMAIL_LOGO_PATH }

// ---------------------------------------------------------------------------
// Buyer: receipt and access link
// ---------------------------------------------------------------------------

export type PurchaseReceiptInput = PurchaseReceiptProps

export function purchaseReceiptEmail(input: PurchaseReceiptInput): EmailContent {
  return {
    subject: purchaseReceiptSubject(input),
    ...renderEmail(createElement(PurchaseReceipt, input)),
  }
}

// ---------------------------------------------------------------------------
// Vendor: a sale
// ---------------------------------------------------------------------------

export type VendorSaleInput = VendorSaleProps

export function vendorSaleEmail(input: VendorSaleInput): EmailContent {
  return {
    subject: vendorSaleSubject(input),
    ...renderEmail(createElement(VendorSale, input)),
  }
}

// ---------------------------------------------------------------------------
// Affiliate: a commission
// ---------------------------------------------------------------------------

export type AffiliateCommissionInput = AffiliateCommissionProps

export function affiliateCommissionEmail(input: AffiliateCommissionInput): EmailContent {
  return {
    subject: affiliateCommissionSubject(input),
    ...renderEmail(createElement(AffiliateCommission, input)),
  }
}

// ---------------------------------------------------------------------------
// Buyer: refund
// ---------------------------------------------------------------------------

export type RefundNoticeInput = RefundNoticeProps

export function refundNoticeEmail(input: RefundNoticeInput): EmailContent {
  return {
    subject: refundNoticeSubject(input),
    ...renderEmail(createElement(RefundNotice, input)),
  }
}

// ---------------------------------------------------------------------------
// Payouts: the step-up code and the withdrawal notices
// ---------------------------------------------------------------------------

export type StepUpCodeInput = StepUpCodeProps

export function stepUpCodeEmail(input: StepUpCodeInput): EmailContent {
  return {
    subject: stepUpCodeSubject(),
    ...renderEmail(createElement(StepUpCode, input)),
  }
}

export type WithdrawalNoticeInput = WithdrawalNoticeProps

export function withdrawalNoticeEmail(input: WithdrawalNoticeInput): EmailContent {
  return {
    subject: withdrawalNoticeSubject(input.status),
    ...renderEmail(createElement(WithdrawalNotice, input)),
  }
}

// ---------------------------------------------------------------------------
// Staff: the VAT reminder
// ---------------------------------------------------------------------------

export type VatReminderInput = VatReminderProps

export function vatReminderEmail(input: VatReminderInput): EmailContent {
  return {
    subject: vatReminderSubject(input),
    ...renderEmail(createElement(VatReminder, input)),
  }
}

// ---------------------------------------------------------------------------
// Staff: the Security page's test message
// ---------------------------------------------------------------------------

export type SystemTestInput = SystemTestProps

export function systemTestEmail(input: SystemTestInput): EmailContent {
  return {
    subject: systemTestSubject(),
    ...renderEmail(createElement(SystemTest, input)),
  }
}
