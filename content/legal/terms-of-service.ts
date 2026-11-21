import {
  COMMISSION_HOLD_DAYS,
  COMMISSION_RANGE_PERCENT,
  LEGAL,
  MIN_WITHDRAWAL_NAIRA,
  PAYOUT_DAYS_TEXT,
  PLATFORM_FEE_PERCENT,
  POLICY_VERSIONS,
  WITHDRAWAL_FEE,
  formatNairaWhole,
  legalIdentityLine,
} from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

const minWithdrawalText = formatNairaWhole(MIN_WITHDRAWAL_NAIRA)
const minWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.minNaira)
const maxWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.capNaira)
const identityText = legalIdentityLine()

export const termsOfServiceDocument: LegalDocumentData = {
  key: "terms_of_service",
  slug: "terms-of-service",
  href: "/terms-of-service",
  title: "Terms of Service",
  description:
    "The core agreement governing accounts, digital product sales, affiliate commissions, payouts, liability and disputes on Affilova.",
  version: POLICY_VERSIONS.terms_of_service,
  effectiveDate: "2026-11-21",
  summary: [
    "Affilova is a digital marketplace connecting independent Vendors, Affiliates and Buyers in Nigeria.",
    `Affilova charges a ${PLATFORM_FEE_PERCENT}% platform fee per completed sale and processes payouts in Nigerian naira (NGN) starting at ${minWithdrawalText}.`,
    `Earnings are held for ${COMMISSION_HOLD_DAYS} days after each sale to cover refunds and payment disputes.`,
    "All uploaded files are scanned for malware, and unlawful or prohibited products are removed.",
    "Disputes follow a 30-day good-faith negotiation period before Nigerian courts in Lagos State.",
  ],
  sections: [
    {
      id: "about-affilova",
      title: "About Affilova and These Terms",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "These ",
              { term: "Terms of Service" },
              " (",
              { term: "Terms" },
              ") form a binding legal agreement between you and ",
              { term: "Affilova" },
              identityText !== "" ? ` (${identityText})` : "",
              " governing your access to and use of the Affilova website, dashboards, checkout, and related services.",
            ],
            [
              "By creating an account, listing or promoting a product, or purchasing through Affilova checkout, you agree to these Terms and our ",
              { link: { label: "Privacy Policy", href: "/privacy-policy" } },
              ", ",
              { link: { label: "Refund Policy", href: "/refund-policy" } },
              ", ",
              { link: { label: "Acceptable Use Policy", href: "/acceptable-use" } },
              ", ",
              { link: { label: "Cookie Policy", href: "/cookie-policy" } },
              ", ",
              { link: { label: "Copyright Policy", href: "/copyright" } },
              ", and ",
              { link: { label: "Earnings Disclaimer", href: "/earnings-disclaimer" } },
              ".",
            ],
            [
              "If you sell products, our ",
              { link: { label: "Vendor Agreement", href: "/vendor-agreement" } },
              " also applies. If you promote products, our ",
              { link: { label: "Affiliate Agreement", href: "/affiliate-agreement" } },
              " also applies.",
            ],
            "You must be at least 18 years old and able to enter into a binding contract under Nigerian law to use Affilova.",
          ],
        },
      ],
    },
    {
      id: "marketplace-roles",
      title: "How the Marketplace Works",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "A ",
              { term: "Vendor" },
              " lists digital products for sale. An ",
              { term: "Affiliate" },
              " promotes listed products through tracked links for a commission. A ",
              { term: "Buyer" },
              " (also called a ",
              { term: "Customer" },
              ") purchases digital products through Affilova checkout.",
            ],
            "Affilova provides product listings, tracked referral links, checkout, digital file delivery, and sales reporting. Affilova collects payments through its payment partner Paystack and distributes shares to Vendors and Affiliates.",
            "Vendors are the sellers of their products. Each Vendor is solely responsible for product content, legality, accuracy, Buyer support, and their own taxes.",
            "Affilova is not the author or publisher of Vendor products. We may review, reject, unpublish, or remove any listing or file that breaches these Terms or applicable law.",
          ],
        },
      ],
    },
    {
      id: "accounts-and-security",
      title: "Accounts, Roles, and Security",
      blocks: [
        {
          type: "clauses",
          items: [
            "You must provide accurate, truthful information when creating an account and keep your details up to date.",
            "One person may hold multiple roles on Affilova, such as buying products while also acting as a Vendor, an Affiliate, or both.",
            "You are responsible for keeping your password and account credentials confidential and for all activity that takes place under your account.",
            [
              "Tell us immediately through our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              " if you believe someone else has accessed your account.",
            ],
          ],
        },
      ],
    },
    {
      id: "fees-and-taxes",
      title: "Fees and Taxes",
      blocks: [
        {
          type: "clauses",
          items: [
            `Affilova charges a platform fee of ${PLATFORM_FEE_PERCENT}% of the sale price on each completed sale, deducted from the Vendor's share.`,
            `Each Vendor sets the Affiliate commission rate per product between ${COMMISSION_RANGE_PERCENT.min}% and ${COMMISSION_RANGE_PERCENT.max}% of the sale price.`,
            "Affilova pays the standard payment processing fee charged by Paystack on checkout transactions.",
            `Each payout or withdrawal is subject to a withdrawal fee of ${WITHDRAWAL_FEE.percent}% of the withdrawal amount, with a minimum fee of ${minWithdrawalFeeText} and a maximum cap of ${maxWithdrawalFeeText}.`,
            "Affilova may update fees by giving at least 14 days' advance notice on the site and by email. Fee changes never apply retroactively to sales that have already been completed.",
            "Each Vendor, Affiliate, and Buyer is responsible for reporting and paying their own taxes. Where Nigerian or other applicable law requires Affilova to collect or remit tax, such as Value Added Tax (VAT), Affilova will calculate, show, and remit that tax as required.",
          ],
        },
      ],
    },
    {
      id: "payments-holds-and-payouts",
      title: "Payments, Holds, and Payouts",
      blocks: [
        {
          type: "clauses",
          items: [
            `Vendor earnings and Affiliate commissions are held for ${COMMISSION_HOLD_DAYS} days after a sale before they become available for withdrawal.`,
            "If an order is refunded or reversed through a bank or card chargeback, the related Vendor and Affiliate earnings are reversed, even if payout has already occurred.",
            "If a reversal creates a negative balance on your account, Affilova will recover that negative balance from your future earnings before further payouts are made.",
            "Payouts are made in Nigerian naira (NGN) only to a Nigerian bank account verified in the account holder's name.",
            `The minimum withdrawal amount is ${minWithdrawalText}. Automatic payouts run on payout days (${PAYOUT_DAYS_TEXT}) whenever your available balance is at least ${minWithdrawalText}, unless you switch automatic payouts off in your settings, in which case you may request manual withdrawals on payout days.`,
            "Withdrawals are unavailable on public holidays, during payment partner downtime, during scheduled maintenance, or on other non-payout days announced by Affilova.",
            "Affilova may delay, freeze, or withhold payouts where reasonably needed for fraud review, open Buyer disputes or chargebacks, incomplete bank or identity verification, suspected policy breaches, or a valid legal order.",
          ],
        },
      ],
    },
    {
      id: "intellectual-property",
      title: "Intellectual Property and Licences",
      blocks: [
        {
          type: "clauses",
          items: [
            "All Affilova software, branding, trademarks, page designs, and documentation belong to Affilova or its licensors. You may not copy, reverse-engineer, scrape, or misuse the platform.",
            "By uploading a product or listing content, the Vendor grants Affilova a worldwide, non-exclusive, royalty-free licence to host, store, scan for malware, display, promote within the marketplace, and deliver that product to Buyers.",
            "When a Buyer completes a purchase, the Vendor grants the Buyer a personal, non-exclusive, non-transferable licence to download and use the product for the Buyer's own use, unless the Vendor explicitly states broader licence terms on the product page. Reselling, redistributing, or sharing files is not permitted unless expressly allowed by the Vendor.",
          ],
        },
      ],
    },
    {
      id: "malware-scanning",
      title: "Malware Scanning and File Safety",
      blocks: [
        {
          type: "clauses",
          items: [
            "Every digital file uploaded by a Vendor is automatically scanned for malware before the product can be published or delivered.",
            "Uploaded files are transmitted securely to a third-party malware scanning provider solely to check whether the file is clean.",
            [
              "Files that fail a malware scan are quarantined and rejected. Repeated failed uploads lead to account suspension as set out in the ",
              { link: { label: "Vendor Agreement", href: "/vendor-agreement" } },
              ".",
            ],
          ],
        },
      ],
    },
    {
      id: "suspension-and-termination",
      title: "Suspension and Termination",
      blocks: [
        {
          type: "clauses",
          items: [
            "You may close your account at any time by contacting support, provided there are no unresolved disputes or negative balances.",
            "Affilova may suspend or terminate your account, remove listings, or block payouts immediately if you engage in fraud, upload malware, list prohibited products, seriously or repeatedly breach these Terms, or if required by a court or regulatory order.",
            "Clauses relating to fees owed, refund and chargeback reversals, negative balance recovery, licences already granted, indemnity, limitation of liability, and dispute resolution survive termination of your account.",
          ],
        },
      ],
    },
    {
      id: "disclaimers-and-liability",
      title: "Disclaimers and Limitation of Liability",
      blocks: [
        {
          type: "clauses",
          items: [
            "Affilova provides the platform on an \"as is\" and \"as available\" basis. We do not promise uninterrupted availability, any level of traffic, or any sales or earnings.",
            "To the fullest extent permitted by law, Affilova is not liable for indirect, consequential, or special losses, or for loss of profits, revenue, data, or goodwill.",
            "To the fullest extent permitted by law, Affilova's total aggregate liability arising out of or relating to these Terms or the platform is capped at the total platform fees Affilova earned from your transactions in the 12 months immediately before the event giving rise to the claim.",
            "Nothing in these Terms limits or excludes any liability that cannot legally be limited or excluded under Nigerian law, including liability for fraud or for death or personal injury caused by negligence.",
          ],
        },
      ],
    },
    {
      id: "indemnity",
      title: "Indemnity",
      blocks: [
        {
          type: "clauses",
          items: [
            "You agree to indemnify and hold harmless Affilova, its officers, and its staff against claims, losses, damages, fines, and reasonable legal costs arising from products you upload or sell, promotions you publish, your breach of these Terms or any law, or your infringement of any third party's rights.",
          ],
        },
      ],
    },
    {
      id: "disputes-and-governing-law",
      title: "Governing Law and Dispute Resolution",
      blocks: [
        {
          type: "clauses",
          items: [
            "These Terms and any dispute arising from them are governed by the laws of the Federal Republic of Nigeria.",
            "Before starting formal legal proceedings, you and Affilova agree to try to resolve any dispute through good-faith written negotiation for 30 days from the date written notice of the dispute is sent.",
            "If the dispute is not resolved within 30 days, either party may submit the dispute to the exclusive jurisdiction of the courts of Lagos State, Nigeria, unless both parties agree in writing to resolve it by arbitration.",
          ],
        },
      ],
    },
    {
      id: "general-terms",
      title: "General Provisions",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Language" },
              ": These Terms are written in English, and all notices and proceedings under them will be in English.",
            ],
            [
              { term: "Notices" },
              ": Affilova may send notices to your account email address or publish them on the Affilova website.",
            ],
            [
              { term: "Changes" },
              ": Material changes to these Terms or linked policies will be notified by email and on the site at least 14 days before they take effect. Continued use after the effective date means you accept the updated Terms.",
            ],
            [
              { term: "Severability" },
              ": If any clause is held invalid or unenforceable by a court, the rest of these Terms remain in full force.",
            ],
            [
              { term: "Entire agreement" },
              ": These Terms and the linked policies form the entire agreement between you and Affilova regarding use of the platform.",
            ],
            [
              { term: "Assignment" },
              ": You may not transfer your rights or obligations under these Terms without our written consent. Affilova may assign its rights to an affiliate or successor.",
            ],
            [
              { term: "Force majeure" },
              ": Neither party is liable for delay or failure caused by events beyond its reasonable control, such as natural disasters, network failures, power outages, strikes, or government actions.",
            ],
            [
              { term: "No waiver" },
              ": Delay in enforcing a right under these Terms does not waive that right.",
            ],
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "paragraph",
          text: [
            "For questions about these Terms or to send formal legal notices, please reach us through our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            LEGAL.supportEmail !== "" ? ` or email ${LEGAL.supportEmail}` : "",
            ".",
          ],
        },
      ],
    },
  ],
}
