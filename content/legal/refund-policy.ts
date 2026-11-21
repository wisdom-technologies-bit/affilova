import { LEGAL, MIN_REFUND_WINDOW_HOURS, POLICY_VERSIONS } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

export const refundPolicyDocument: LegalDocumentData = {
  key: "refund_policy",
  slug: "refund-policy",
  href: "/refund-policy",
  title: "Refund Policy",
  description:
    "How product refund windows, automatic refunds, Vendor-reviewed refunds, chargebacks and refund abuse work on Affilova.",
  version: POLICY_VERSIONS.refund_policy,
  effectiveDate: "2026-11-21",
  summary: [
    `Every listed product carries a Vendor-set refund window of at least ${MIN_REFUND_WINDOW_HOURS} hours from purchase.`,
    "Refund requests made inside the product's refund window are approved automatically.",
    "Requests made after the window closes are routed to the Vendor, though Affilova may still refund broken, infected or misdescribed products.",
    "Approved refunds return to your original payment method via Paystack and immediately remove download access.",
    "Repeated bad-faith refund requests or chargeback abuse may result in account suspension.",
  ],
  sections: [
    {
      id: "refund-windows",
      title: "Refund Windows",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "A ",
              { term: "Refund Window" },
              ` is the period after purchase during which a Buyer can request an automatic refund. Every Vendor chooses a Refund Window for each product, which must be at least ${MIN_REFUND_WINDOW_HOURS} hours.`,
            ],
            "The exact Refund Window for a product is shown on the product page before checkout and on the order access page after payment.",
          ],
        },
      ],
    },
    {
      id: "how-decisions-are-made",
      title: "Automatic and Reviewed Refunds",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Inside the Refund Window" },
              ": any refund request submitted before the product's Refund Window closes is approved automatically by the platform.",
            ],
            [
              { term: "After the Refund Window" },
              ": requests submitted after the window closes are sent to the Vendor to approve or decline.",
            ],
            [
              { term: "Platform intervention" },
              ": even after a Refund Window expires, Affilova may approve a refund if we confirm a policy breach, malware, non-delivery of the product files, or a product that was materially misdescribed on its listing page.",
            ],
          ],
        },
      ],
    },
    {
      id: "how-to-request",
      title: "How to Request a Refund",
      blocks: [
        {
          type: "clauses",
          items: [
            "Open the order access link in your purchase receipt email, or use the access resend page if your link has expired.",
            "Signed-in Buyers may also request a refund from their account orders page.",
            [
              "If you are reporting a policy violation after the Refund Window has passed, contact us through our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              " with your order number and a clear explanation.",
            ],
          ],
        },
      ],
    },
    {
      id: "payout-of-refunds-and-access",
      title: "Refund Processing and Access Removal",
      blocks: [
        {
          type: "clauses",
          items: [
            "Approved refunds are sent back to the original payment method through our payment partner Paystack.",
            "Once Affilova initiates a refund with Paystack, the time it takes to appear in your bank or card statement depends on Paystack and your bank or card issuer.",
            "When a refund is approved, your download access to the refunded product files ends immediately, and related Vendor earnings and Affiliate commissions are reversed.",
          ],
        },
      ],
    },
    {
      id: "chargebacks-and-disputes",
      title: "Chargebacks and Payment Disputes",
      blocks: [
        {
          type: "clauses",
          items: [
            "If a Buyer opens a card or bank chargeback through their bank or Paystack, the dispute is handled under Paystack and card-network rules.",
            "While a chargeback or payment dispute is open, download access to the order's files is suspended.",
            "If a chargeback succeeds, the order is treated as reversed and the related Vendor and Affiliate earnings are reversed.",
          ],
        },
      ],
    },
    {
      id: "refund-abuse",
      title: "Preventing Refund Abuse",
      blocks: [
        {
          type: "clauses",
          items: [
            "Repeatedly buying digital products, downloading the files, and requesting refunds in bad faith undermines Vendors and is prohibited.",
            "Where Affilova detects a pattern of refund abuse, we may restrict future automatic refunds or suspend the Buyer's account.",
          ],
        },
      ],
    },
    {
      id: "changes-and-contact",
      title: "Changes and Contact",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Material updates to this Refund Policy will be notified at least 14 days in advance on the site and by email. For help with an order, visit our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            ".",
          ],
        },
      ],
    },
  ],
}
