import {
  COMMISSION_HOLD_DAYS,
  COMMISSION_RANGE_PERCENT,
  LEGAL,
  MIN_WITHDRAWAL_NAIRA,
  PAYOUT_DAYS_TEXT,
  POLICY_VERSIONS,
  WITHDRAWAL_FEE,
  formatNairaWhole,
} from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

const minWithdrawalText = formatNairaWhole(MIN_WITHDRAWAL_NAIRA)
const minWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.minNaira)
const maxWithdrawalFeeText = formatNairaWhole(WITHDRAWAL_FEE.capNaira)

export const affiliateAgreementDocument: LegalDocumentData = {
  key: "affiliate_agreement",
  slug: "affiliate-agreement",
  href: "/affiliate-agreement",
  title: "Affiliate Agreement",
  description:
    "Terms governing Affiliates promoting Vendor products on Affilova, covering last-click attribution, holds, self-referral bans, disclosures and fraud.",
  version: POLICY_VERSIONS.affiliate_agreement,
  effectiveDate: "2026-11-21",
  summary: [
    "Affiliates are independent contractors, not employees or agents, and earn strictly single-level sales commissions (no MLM).",
    `Commissions range from ${COMMISSION_RANGE_PERCENT.min}% to ${COMMISSION_RANGE_PERCENT.max}% per product using a 30-day last-click afv_ref cookie.`,
    `Commissions are held for ${COMMISSION_HOLD_DAYS} days and reverse if a Buyer receives a refund or chargeback.`,
    `Payouts run ${PAYOUT_DAYS_TEXT} in NGN from ${minWithdrawalText} with a ${WITHDRAWAL_FEE.percent}% fee (${minWithdrawalFeeText}–${maxWithdrawalFeeText}).`,
    "Self-referrals, spam, fake claims, bot clicks and undisclosed links result in termination and commission forfeiture.",
  ],
  sections: [
    {
      id: "relationship-and-eligibility",
      title: "Independent Status and Eligibility",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "This ",
              { term: "Affiliate Agreement" },
              " governs your promotion of Vendor products on Affilova and incorporates our ",
              { link: { label: "Terms of Service", href: "/terms-of-service" } },
              ", ",
              { link: { label: "Acceptable Use Policy", href: "/acceptable-use" } },
              ", ",
              { link: { label: "Earnings Disclaimer", href: "/earnings-disclaimer" } },
              ", and ",
              { link: { label: "Privacy Policy", href: "/privacy-policy" } },
              ".",
            ],
            "You act strictly as an independent contractor. Nothing in this agreement creates an employment, agency, partnership, or joint-venture relationship between you and Affilova or any Vendor. You have no authority to make promises or enter contracts on behalf of Affilova or a Vendor.",
            "You must be at least 18 years old, declare your real promotion channels accurately, and verify a Nigerian bank account in your own name to receive payouts.",
          ],
        },
      ],
    },
    {
      id: "attribution-and-commissions",
      title: "Tracking, Attribution, and Commissions",
      blocks: [
        {
          type: "clauses",
          items: [
            "You earn commission only on completed, paid purchases made through your active tracked Affilova affiliate links where you are eligible to promote that product.",
            [
              "Attribution uses a last-click rule per product within a 30-day attribution window stored in the first-party ",
              { term: "afv_ref" },
              " cookie.",
            ],
            `Commission rates are set per product by the Vendor between ${COMMISSION_RANGE_PERCENT.min}% and ${COMMISSION_RANGE_PERCENT.max}% of the sale price, using the rate active at the time of purchase.`,
            "Single-level programme only: Affilova pays commission solely on referred product sales. There is no payment, override, or bonus for recruiting other affiliates or vendors.",
          ],
        },
      ],
    },
    {
      id: "holds-reversals-and-payouts",
      title: "Commission Holds, Reversals, and Payouts",
      blocks: [
        {
          type: "clauses",
          items: [
            `Earned commissions are held for ${COMMISSION_HOLD_DAYS} days after the sale before they move to your available balance for withdrawal.`,
            "If an order is refunded or reversed via chargeback, your related commission is reversed, even after payout. Any resulting negative balance is recovered from future commissions.",
            `Payouts run in Nigerian naira on payout days (${PAYOUT_DAYS_TEXT}) once your available balance reaches ${minWithdrawalText}, subject to a withdrawal fee of ${WITHDRAWAL_FEE.percent}% (minimum ${minWithdrawalFeeText}, capped at ${maxWithdrawalFeeText}).`,
          ],
        },
      ],
    },
    {
      id: "self-referrals",
      title: "No Self-Referrals",
      blocks: [
        {
          type: "clauses",
          items: [
            "You may not earn commission on your own purchases or on purchases placed through any account you own, manage, or control.",
            "Where Affilova detects a self-referral, commission is cancelled and repeated attempts may result in account termination.",
          ],
        },
      ],
    },
    {
      id: "prohibited-promotion",
      title: "Prohibited Promotion Methods",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Spam" },
              ": unsolicited bulk email, SMS, automated direct messages, or unsolicited WhatsApp or Telegram group blasting.",
            ],
            [
              { term: "Misleading or false claims" },
              ": inventing features, fabricating reviews or testimonials, or promising guaranteed income, returns, or results.",
            ],
            [
              { term: "Impersonation" },
              ": pretending to be Affilova, the Vendor, or the product author, or using confusingly similar handles or domains.",
            ],
            [
              { term: "Forced, hidden, or incentivised clicks" },
              ": invisible iframes, auto-redirects, pop-unders, cookie stuffing, paying or rewarding users merely to click links, fake accounts, or bot traffic.",
            ],
            [
              { term: "Adult or illegal traffic sources" },
              ": placing affiliate links on adult, pirated, malware, or unlawful websites or channels.",
            ],
            [
              { term: "Misleading brand bidding or trademark abuse" },
              ": using a Vendor's or product's brand name in search ads, social profiles, or domain names in a way that misleads buyers into thinking they are dealing directly with the Vendor.",
            ],
          ],
        },
      ],
    },
    {
      id: "mandatory-disclosure",
      title: "Mandatory Affiliate Disclosure",
      blocks: [
        {
          type: "clauses",
          items: [
            "Whenever you share an affiliate link — in blog posts, videos, social posts, emails, or messaging channels — you must clearly and prominently disclose that the link is an affiliate link and that you may earn a commission from qualifying purchases.",
            "Disclosures must appear where a buyer can read them before clicking the link, not buried in fine print or hidden behind menus.",
          ],
        },
      ],
    },
    {
      id: "compliance-and-taxes",
      title: "Channel Compliance and Taxes",
      blocks: [
        {
          type: "clauses",
          items: [
            "You are solely responsible for following all advertising, consumer-protection, anti-spam, and platform rules that apply to your own promotion channels.",
            "You are solely responsible for declaring and paying any income or other taxes due on commissions you earn.",
          ],
        },
      ],
    },
    {
      id: "fraud-and-termination",
      title: "Fraud, Forfeiture, and Termination",
      blocks: [
        {
          type: "clauses",
          items: [
            "Engaging in click fraud, self-referral, spam, deceptive claims, or other material breaches of this agreement leads to immediate suspension or termination of your Affiliate account.",
            "If your account is terminated for fraud or material breach, all pending and fraudulently generated commissions are forfeited to the fullest extent permitted by law.",
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
            "This Affiliate Agreement is governed by the laws of the Federal Republic of Nigeria, with 30 days of good-faith negotiation followed by the courts of Lagos State as set out in the ",
            { link: { label: "Terms of Service", href: "/terms-of-service" } },
            ". Contact us via our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            ".",
          ],
        },
      ],
    },
  ],
}
