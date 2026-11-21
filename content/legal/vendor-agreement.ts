import {
  COMMISSION_HOLD_DAYS,
  COMMISSION_RANGE_PERCENT,
  LEGAL,
  MIN_REFUND_WINDOW_HOURS,
  MIN_WITHDRAWAL_NAIRA,
  PAYOUT_DAYS_TEXT,
  PLATFORM_FEE_PERCENT,
  POLICY_VERSIONS,
  WITHDRAWAL_FEE,
  formatNairaWhole,
} from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

const minWithdrawalText = formatNairaWhole(MIN_WITHDRAWAL_NAIRA)
const minWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.minNaira)
const maxWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.capNaira)

export const vendorAgreementDocument: LegalDocumentData = {
  key: "vendor_agreement",
  slug: "vendor-agreement",
  href: "/vendor-agreement",
  title: "Vendor Agreement",
  description:
    "Terms governing Vendors selling digital products on Affilova, covering ownership warranties, refunds, fees, malware strikes and affiliate controls.",
  version: POLICY_VERSIONS.vendor_agreement,
  effectiveDate: "2026-11-21",
  summary: [
    "Vendors warrant that they own or have full rights to sell every listed product and that descriptions are honest.",
    "All sales and file deliveries must stay on Affilova; taking Buyers off-platform to evade fees is prohibited.",
    `Vendors must set a refund window of at least ${MIN_REFUND_WINDOW_HOURS} hours and honour automatic in-window refunds.`,
    `Affilova deducts a ${PLATFORM_FEE_PERCENT}% platform fee and Vendor-set affiliate commissions (${COMMISSION_RANGE_PERCENT.min}%–${COMMISSION_RANGE_PERCENT.max}%), holding net earnings for ${COMMISSION_HOLD_DAYS} days.`,
    "Two infected file uploads within 30 days automatically suspend a Vendor account.",
  ],
  sections: [
    {
      id: "eligibility-and-incorporation",
      title: "Eligibility, Verification, and Related Terms",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "This ",
              { term: "Vendor Agreement" },
              " applies when you activate a Vendor store on Affilova. It incorporates our ",
              { link: { label: "Terms of Service", href: "/terms-of-service" } },
              ", ",
              { link: { label: "Acceptable Use Policy", href: "/acceptable-use" } },
              ", ",
              { link: { label: "Refund Policy", href: "/refund-policy" } },
              ", ",
              { link: { label: "Copyright Policy", href: "/copyright" } },
              ", and ",
              { link: { label: "Privacy Policy", href: "/privacy-policy" } },
              ".",
            ],
            "You confirm that you are at least 18 years old, have provided accurate business and support contact details, and will verify a Nigerian bank account in your own name (or your business's name) to receive payouts.",
          ],
        },
      ],
    },
    {
      id: "ownership-and-listings",
      title: "Ownership Warranties and Listing Accuracy",
      blocks: [
        {
          type: "clauses",
          items: [
            "You warrant that you created every product you upload or hold all licences and permissions required to sell it on Affilova without infringing anyone's copyright, trademark, trade secret, or privacy rights.",
            "Every product title, description, preview image, file list, and Refund Window must describe what the Buyer actually receives accurately and honestly, without false promises or fabricated testimonials.",
            "Products are reviewed before publication. Passing review confirms marketplace eligibility only; it does not waive your warranties or shift legal responsibility to Affilova.",
          ],
        },
      ],
    },
    {
      id: "delivery-and-support",
      title: "Platform Delivery, No Off-Platform Payment, and Support",
      blocks: [
        {
          type: "clauses",
          items: [
            "Digital product files must be uploaded to Affilova so buyers receive secure delivery after checkout. Listing placeholder files or redirecting Buyers off-platform to complete payment is prohibited.",
            "You must maintain a working support email address and respond to legitimate Buyer product questions within a reasonable time.",
            "Using Affilova listings to route Buyers or Affiliates away from Affilova checkout to avoid platform fees or commissions is grounds for immediate termination.",
          ],
        },
      ],
    },
    {
      id: "buyer-data",
      title: "Buyer Data Boundaries",
      blocks: [
        {
          type: "clauses",
          items: [
            "Buyer email addresses and personal purchase records stay with Affilova. Vendors do not receive Buyer email addresses unless a Buyer chooses to contact the Vendor directly for support.",
            "If a Buyer contacts you directly, you may use their details only to answer that support request and must comply with the Nigeria Data Protection Act 2023.",
          ],
        },
      ],
    },
    {
      id: "refunds",
      title: "Refund Obligations",
      blocks: [
        {
          type: "clauses",
          items: [
            `Every product you list must include a Refund Window of at least ${MIN_REFUND_WINDOW_HOURS} hours from purchase.`,
            "Refund requests submitted within your product's Refund Window are approved automatically by the platform.",
            "For requests submitted after the Refund Window closes, you agree to review them fairly and promptly. You also accept Affilova's decision where Affilova approves a refund for malware, non-delivery, or a materially misdescribed product.",
          ],
        },
      ],
    },
    {
      id: "fees-holds-and-payouts",
      title: "Fees, Holds, Reversals, and Payouts",
      blocks: [
        {
          type: "clauses",
          items: [
            `Affilova deducts a ${PLATFORM_FEE_PERCENT}% platform fee from the sale price on every completed sale.`,
            `When a Buyer arrives through an Affiliate link, the Affiliate commission you configured for that product (between ${COMMISSION_RANGE_PERCENT.min}% and ${COMMISSION_RANGE_PERCENT.max}% of the sale price) is also deducted before your Vendor net share is credited.`,
            `Vendor earnings are held for ${COMMISSION_HOLD_DAYS} days before becoming available for payout.`,
            `Payouts are paid in Nigerian naira on payout days (${PAYOUT_DAYS_TEXT}) once your available balance meets the ${minWithdrawalText} minimum, subject to a withdrawal fee of ${WITHDRAWAL_FEE.percent}% (minimum ${minWithdrawalFeeText}, capped at ${maxWithdrawalFeeText}).`,
            "Refunds and chargebacks reverse the related Vendor earnings even if payout has already occurred. Any resulting negative balance is recovered from future Vendor earnings.",
          ],
        },
      ],
    },
    {
      id: "affiliate-programme-controls",
      title: "Affiliate Programme Controls",
      blocks: [
        {
          type: "clauses",
          items: [
            "For each product, you choose how Affiliates join: open to all Affiliates, subject to your approval, or by invitation only.",
            "You may decline an Affiliate request or block an existing Affiliate on your product where you have a valid reason, such as brand mismatch or promotional policy concerns. Blocking an Affiliate immediately disables their active links for that product.",
            "You may change a product's Affiliate commission rate at any time, but any change applies strictly to future clicks and sales — never retroactively to pending or completed sales.",
          ],
        },
      ],
    },
    {
      id: "malware-strikes",
      title: "Malware Scanning and Two-Strike Suspension",
      blocks: [
        {
          type: "clauses",
          items: [
            "Every file you upload is automatically scanned for malware by our scanning partner before it can go live.",
            "If two files uploaded to your Vendor account are rejected as infected within any rolling 30-day window, your Vendor account will be suspended automatically.",
            "Affilova may also suspend a Vendor account immediately after a single upload if we see evidence of deliberate malware distribution.",
          ],
        },
      ],
    },
    {
      id: "indemnity-and-termination",
      title: "Indemnity, Termination, and Funds After Termination",
      blocks: [
        {
          type: "clauses",
          items: [
            "You agree to indemnify Affilova against all claims, damages, regulatory fines, chargeback losses, and reasonable legal costs arising from your products, intellectual property claims, misleading descriptions, or tax obligations.",
            [
              "Either you or Affilova may terminate this Vendor Agreement as set out in the ",
              { link: { label: "Terms of Service", href: "/terms-of-service" } },
              ". On termination, your products are removed from sale.",
            ],
            "Subject to fraud, dispute, and legal-order holds, earned and cleared funds remaining in your Vendor balance after the hold period and any refund or chargeback deductions will be paid out to your verified bank account after review.",
          ],
        },
      ],
    },
    {
      id: "governing-law-and-contact",
      title: "Governing Law and Contact",
      blocks: [
        {
          type: "paragraph",
          text: [
            "This Vendor Agreement is governed by Nigerian law with the 30-day negotiation and Lagos State court provisions in our ",
            { link: { label: "Terms of Service", href: "/terms-of-service" } },
            ". Contact us through our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            ".",
          ],
        },
      ],
    },
  ],
}
