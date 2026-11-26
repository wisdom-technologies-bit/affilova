import { createElement } from "react"
import type { ComponentType } from "react"

import { renderEmail } from "@/emails/render"
import { AffiliateCommission, affiliateCommissionSample, affiliateCommissionSubject } from "@/emails/templates/affiliate-commission"
import { AUTH_EMAIL_FILES, authTemplateVariablesSample, authSampleBranding } from "@/emails/templates/auth"
import { PurchaseReceipt, purchaseReceiptSample, purchaseReceiptSubject } from "@/emails/templates/purchase-receipt"
import { RefundNotice, refundNoticeSample, refundNoticeSubject } from "@/emails/templates/refund-notice"
import { StepUpCode, stepUpCodeSample, stepUpCodeSubject } from "@/emails/templates/step-up-code"
import { SystemTest, systemTestSample, systemTestSubject } from "@/emails/templates/system-test"
import { VatReminder, vatReminderOverdueSample, vatReminderSample, vatReminderSubject } from "@/emails/templates/vat-reminder"
import { VendorSale, vendorSaleSample, vendorSaleSubject } from "@/emails/templates/vendor-sale"
import {
  WithdrawalNotice,
  withdrawalNoticeSamples,
  withdrawalNoticeSubject,
} from "@/emails/templates/withdrawal-notice"
import type { RenderedEmail } from "@/emails/types"

// Every message this product sends, with the props the style guide shows it with.
//
// One list, used by two things that must agree: the Emails section of the admin
// style guide, and the template tests. A template that is added to the send path
// and not to this list is a template nobody has looked at, and one added here and
// not to the send path is dead weight: both are visible in a diff.
//
// The list is a function rather than a module constant so nothing renders at
// import time: importing this file from a page or a test costs nothing until it
// is called.

export interface EmailTemplateEntry extends RenderedEmail {
  /** The stable name used in the log line and the send path. */
  name: string
  /** The name a person reads. */
  title: string
  /** One sentence: when it is sent, and to whom. */
  when: string
  /**
   * The props this entry was rendered with.
   *
   * Kept so a test can render the same template again and compare the two
   * renderers, and so the style guide and the tests cannot disagree about what
   * "the sample" is. Unknown on purpose: the catalogue holds thirteen different
   * prop shapes and a caller that reads this is re-rendering, not inspecting.
   */
  sample: unknown
}

/** One entry, rendered. `component` is called through createElement, never bare. */
function entry<P extends object>(input: {
  name: string
  title: string
  when: string
  sample: P
  subject: (props: P) => string
  component: ComponentType<P>
}): EmailTemplateEntry {
  const rendered = renderEmail(createElement(input.component, input.sample))

  return {
    name: input.name,
    title: input.title,
    when: input.when,
    subject: input.subject(input.sample),
    sample: input.sample,
    html: rendered.html,
    text: rendered.text,
  }
}

/** Every template, in the order the style guide lists them. */
export function emailTemplateCatalog(): readonly EmailTemplateEntry[] {
  const transactional: readonly EmailTemplateEntry[] = [
    entry({
      name: "purchase_receipt",
      title: "Purchase receipt",
      when: "To a buyer, when a payment settles. Carries the download link.",
      sample: purchaseReceiptSample,
      subject: purchaseReceiptSubject,
      component: PurchaseReceipt,
    }),
    entry({
      name: "vendor_sale",
      title: "Vendor sale notice",
      when: "To the vendor whose product sold.",
      sample: vendorSaleSample,
      subject: vendorSaleSubject,
      component: VendorSale,
    }),
    entry({
      name: "affiliate_commission",
      title: "Affiliate commission notice",
      when: "To the affiliate whose link led to the sale.",
      sample: affiliateCommissionSample,
      subject: affiliateCommissionSubject,
      component: AffiliateCommission,
    }),
    entry({
      name: "refund_notice",
      title: "Refund notice",
      when: "To the buyer, when a refund has been issued.",
      sample: refundNoticeSample,
      subject: refundNoticeSubject,
      component: RefundNotice,
    }),
    entry({
      name: "step_up_code",
      title: "Payout step-up code",
      when: "To a vendor, affiliate or staff member before a payout change.",
      sample: stepUpCodeSample,
      subject: stepUpCodeSubject,
      component: StepUpCode,
    }),
    entry({
      name: "withdrawal_notice",
      title: "Withdrawal paid",
      when: "To the person who requested the withdrawal, when the transfer is paid.",
      sample: withdrawalNoticeSamples[0],
      subject: (props) => withdrawalNoticeSubject(props.status),
      component: WithdrawalNotice,
    }),
    entry({
      name: "withdrawal_notice_failed",
      title: "Withdrawal failed",
      when: "The transfer could not be completed. The money is back in the balance.",
      sample: withdrawalNoticeSamples[1],
      subject: (props) => withdrawalNoticeSubject(props.status),
      component: WithdrawalNotice,
    }),
    entry({
      name: "withdrawal_notice_reversed",
      title: "Withdrawal reversed",
      when: "The transfer was sent back before it arrived.",
      sample: withdrawalNoticeSamples[2],
      subject: (props) => withdrawalNoticeSubject(props.status),
      component: WithdrawalNotice,
    }),
    entry({
      name: "withdrawal_notice_rejected",
      title: "Withdrawal rejected",
      when: "Staff did not approve the request. Carries the reason.",
      sample: withdrawalNoticeSamples[3],
      subject: (props) => withdrawalNoticeSubject(props.status),
      component: WithdrawalNotice,
    }),
    entry({
      name: "vat_reminder",
      title: "VAT reminder",
      when: "To finance and admin, once per month and reminder.",
      sample: vatReminderSample,
      subject: vatReminderSubject,
      component: VatReminder,
    }),
    entry({
      name: "vat_reminder_overdue",
      title: "VAT reminder, overdue",
      when: "The same reminder once the due date has passed.",
      sample: vatReminderOverdueSample,
      subject: vatReminderSubject,
      component: VatReminder,
    }),
    entry({
      name: "admin_email_test",
      title: "System test",
      when: "To the signed-in admin, from the Security page's Send test email button.",
      sample: systemTestSample,
      subject: systemTestSubject,
      component: SystemTest,
    }),
  ]

  return [...transactional, ...authTemplateEntries()]
}

/**
 * The four Supabase Auth templates.
 *
 * They are in the list so the style guide shows them too, with Supabase's own
 * variables in place of an address. The subject is the line the owner types into
 * the dashboard: Supabase keeps it, not this code.
 */
function authTemplateEntries(): readonly EmailTemplateEntry[] {
  return AUTH_EMAIL_FILES.map((file) =>
    entry({
      name: `supabase_${file.file.replace(/^supabase-|\.html$/g, "").replace(/-/g, "_")}`,
      title: `${file.template} (Supabase Auth)`,
      when: "Sent by Supabase Auth, not by this app. The HTML is pasted into the dashboard.",
      sample: { ...authTemplateVariablesSample, branding: authSampleBranding },
      subject: () => file.subject,
      component: file.component,
    }),
  )
}
