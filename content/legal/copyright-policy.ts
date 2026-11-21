import { LEGAL, POLICY_VERSIONS } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

export const copyrightPolicyDocument: LegalDocumentData = {
  key: "copyright_policy",
  slug: "copyright",
  href: "/copyright",
  title: "Copyright and Takedown Policy",
  description:
    "How intellectual property owners can report infringing products on Affilova and how Vendors can submit a counter-notice.",
  version: POLICY_VERSIONS.copyright_policy,
  effectiveDate: "2026-11-21",
  summary: [
    "Vendors may list only original digital works or products they have full permission to sell.",
    "Rights owners can request removal by sending a complete written takedown notice through our Contact page.",
    "Affilova promptly disables access to validly reported listings and notifies the Vendor.",
    "Vendors may submit a counter-notice for mistaken removals; listings may be restored after 10 business days absent a court filing.",
    "Repeat copyright or trademark infringers face permanent account termination.",
  ],
  sections: [
    {
      id: "respect-for-ip",
      title: "Respect for Intellectual Property",
      blocks: [
        {
          type: "clauses",
          items: [
            "Vendors may list only digital products they created or have full legal permission to sell.",
            "If you believe a product or listing on Affilova infringes your copyright, trademark, or other intellectual property rights, you can ask us to take it down using the procedure below.",
          ],
        },
      ],
    },
    {
      id: "takedown-notice",
      title: "How to Submit a Takedown Notice",
      blocks: [
        {
          type: "paragraph",
          text: "Every copyright or trademark takedown notice must include all of the following:",
        },
        {
          type: "clauses",
          items: [
            [
              { term: "Identification of the protected work" },
              ": a clear description of the copyrighted work or trademark you claim has been infringed (for example, a title, registration number, or link to an authorised copy).",
            ],
            [
              { term: "Exact Affilova URL" },
              ": the specific URL(s) on Affilova where the allegedly infringing product or material appears.",
            ],
            [
              { term: "Claimant contact details" },
              ": your full name, organisation (if acting for a company), email address, and phone number or postal address.",
            ],
            [
              { term: "Good-faith statement" },
              ": a statement that you have a good-faith belief that the reported use is not authorised by the rights owner, its agent, or the law.",
            ],
            [
              { term: "Accuracy and authority statement" },
              ": a statement that the information in your notice is accurate and, under penalty of false declaration, that you are the rights owner or are authorised to act on the owner's behalf.",
            ],
            [
              { term: "Signature" },
              ": your physical or typed electronic signature.",
            ],
          ],
        },
      ],
    },
    {
      id: "our-response",
      title: "How Affilova Responds",
      blocks: [
        {
          type: "clauses",
          items: [
            "When we receive a complete, valid takedown notice, Affilova will promptly remove or disable access to the reported product listing and files.",
            "We will notify the Vendor of the takedown and share the details of the notice (excluding sensitive personal details where inappropriate) so the Vendor understands why the listing was disabled.",
            "If a notice is incomplete, we may ask you for the missing information before taking action.",
          ],
        },
      ],
    },
    {
      id: "counter-notice",
      title: "Counter-Notice and Restoration",
      blocks: [
        {
          type: "clauses",
          items: [
            "If you are a Vendor and believe your product was removed due to mistake or misidentification, you may submit a counter-notice.",
            "Your counter-notice must include: your full name and contact details, identification of the product and URL that was removed, a statement under penalty of false declaration that you have a good-faith belief the removal resulted from mistake or misidentification, your consent to the jurisdiction of the courts of Lagos State, Nigeria, and your physical or electronic signature.",
            "We will forward your counter-notice to the original claimant. Unless the claimant notifies us within 10 business days that they have filed a court action seeking an order against you, Affilova may restore the product listing.",
          ],
        },
      ],
    },
    {
      id: "repeat-infringers-and-false-notices",
      title: "Repeat Infringers and False Notices",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Repeat infringers" },
              ": Affilova maintains a strict repeat-infringer policy and will permanently terminate the accounts of Vendors who receive repeated valid copyright or trademark takedown notices.",
            ],
            [
              { term: "False notices" },
              ": knowingly submitting a false takedown notice or false counter-notice may expose you to legal liability for damages and costs, and may lead to suspension or termination of your Affilova account.",
            ],
          ],
        },
      ],
    },
    {
      id: "where-to-send-notices",
      title: "Where to Send Notices",
      blocks: [
        {
          type: "paragraph",
          text: [
            "Send all copyright takedown notices and counter-notices through our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            ' with the subject line "Copyright Takedown Notice" or "Copyright Counter-Notice".',
          ],
        },
      ],
    },
  ],
}
