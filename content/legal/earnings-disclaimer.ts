import { LEGAL, POLICY_VERSIONS } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

export const earningsDisclaimerDocument: LegalDocumentData = {
  key: "earnings_disclaimer",
  slug: "earnings-disclaimer",
  href: "/earnings-disclaimer",
  title: "Earnings Disclaimer",
  description:
    "Plain statement that Affilova makes no guarantee of sales, commissions or income for Vendors or Affiliates.",
  version: POLICY_VERSIONS.earnings_disclaimer,
  effectiveDate: "2026-11-21",
  summary: [
    "Using Affilova does not guarantee sales, affiliate commissions or any level of income.",
    "Any fee or split examples on Affilova are mathematical illustrations only, not earnings promises.",
    "Actual results depend on product quality, pricing, marketing effort, audience trust and refunds.",
    "Past performance by any Vendor or Affiliate does not predict future earnings.",
    "Nothing on Affilova is financial, investment, tax or legal advice.",
  ],
  sections: [
    {
      id: "no-guarantee",
      title: "No Guarantee of Earnings",
      blocks: [
        {
          type: "clauses",
          items: [
            "Affilova provides software tools to list digital products, process payments, track affiliate links, and report sales.",
            "We make no representation, warranty, or guarantee that you will make any sales, earn any commissions, or achieve any level of income by using Affilova as a Vendor or an Affiliate.",
          ],
        },
      ],
    },
    {
      id: "illustrative-examples",
      title: "Examples Are Illustrations Only",
      blocks: [
        {
          type: "clauses",
          items: [
            "Any fee, split, commission, or earnings figures used anywhere on Affilova or in documentation are strictly mathematical illustrations showing how calculations work.",
            "They must not be read as a forecast, promise, or typical result for your store or affiliate promotions.",
          ],
        },
      ],
    },
    {
      id: "factors-affecting-results",
      title: "What Results Depend On",
      blocks: [
        {
          type: "clauses",
          items: [
            "Your outcomes on Affilova depend on factors wholly outside our control, including the quality and usefulness of the product, pricing, audience size and trust, marketing skill, time and effort invested, refund rates, and broader market conditions.",
            "Some users earn substantial revenue, while many earn little or nothing. Past performance by any Vendor or Affiliate does not predict future results.",
          ],
        },
      ],
    },
    {
      id: "no-professional-advice",
      title: "Not Professional Advice and Contact",
      blocks: [
        {
          type: "clauses",
          items: [
            "Nothing published on Affilova constitutes financial, investment, tax, legal, or business advice. You should evaluate any commercial risk independently and consult a qualified professional before relying on any business decision.",
            [
              "Questions about this Earnings Disclaimer can be sent via our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              ".",
            ],
          ],
        },
      ],
    },
  ],
}
