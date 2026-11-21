import { LEGAL, POLICY_VERSIONS, legalIdentityLine } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

const identityText = legalIdentityLine()

export const privacyPolicyDocument: LegalDocumentData = {
  key: "privacy_policy",
  slug: "privacy-policy",
  href: "/privacy-policy",
  title: "Privacy Policy",
  description:
    "How Affilova collects, uses, stores, transfers and protects personal data in compliance with the Nigeria Data Protection Act 2023.",
  version: POLICY_VERSIONS.privacy_policy,
  effectiveDate: "2026-11-21",
  summary: [
    "Affilova handles personal data under the Nigeria Data Protection Act 2023 (NDPA).",
    "We collect only the account, role, order, payout, support and hashed security data needed to run the marketplace.",
    "Payment card details go directly to Paystack and never touch Affilova's servers or logs.",
    "Click records drop raw IP addresses using daily-rotating hashes and purge after 13 months; financial records stay 6 years for tax law.",
    "You have rights to access, correct, delete, port and object, plus the right to complain to the Nigeria Data Protection Commission (NDPC).",
  ],
  sections: [
    {
      id: "controller",
      title: "Who We Are (Data Controller)",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "This ",
              { term: "Privacy Policy" },
              " explains how ",
              { term: "Affilova" },
              identityText !== "" ? ` (${identityText})` : "",
              " processes ",
              { term: "Personal Data" },
              " in accordance with the ",
              { term: "Nigeria Data Protection Act 2023" },
              " (",
              { term: "NDPA" },
              ").",
            ],
            [
              "You can reach our data protection team through our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              LEGAL.dataProtectionContact !== ""
                ? ` or at ${LEGAL.dataProtectionContact}`
                : "",
              ".",
            ],
          ],
        },
      ],
    },
    {
      id: "data-we-collect",
      title: "Personal Data We Collect",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Account and sign-in data" },
              ": name, email address, hashed password or Google sign-in identifier, and account role status.",
            ],
            [
              { term: "Role and verification data" },
              ": Vendor business name, store slug, support email, optional phone number, Affiliate username, declared promotion channels, and country.",
            ],
            [
              { term: "Payout bank details" },
              ": full bank account verification is handled by our payment partner Paystack. Affilova keeps only the bank name, verified account name, a masked account suffix (last digits), and Paystack's recipient reference.",
            ],
            [
              { term: "Purchase and order data" },
              ": Buyer email address, optional Buyer name, products purchased, order reference, payment status, refund requests, and delivery events.",
            ],
            [
              { term: "Support messages" },
              ": details you provide when submitting a support ticket or reporting a listing.",
            ],
            [
              { term: "Technical and fraud-prevention data" },
              ": daily-rotating hashes of IP addresses and device or browser user-agent strings, referral site domain, affiliate click identifiers, and policy acceptance timestamps with hashed IP.",
            ],
          ],
        },
      ],
    },
    {
      id: "purposes-and-lawful-bases",
      title: "Purposes and Lawful Bases",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Performance of a contract" },
              ": creating and managing your account, listing products, processing checkout, delivering digital files, attributing affiliate sales, processing refunds, and issuing payouts.",
            ],
            [
              { term: "Legal obligations" },
              ": keeping financial and tax records, preventing unlawful transactions, complying with NDPA breach reporting, and responding to lawful court or regulatory orders.",
            ],
            [
              { term: "Legitimate interests" },
              ": scanning uploaded files for malware, stopping bots and payment fraud, rate limiting abuse, monitoring application crashes without collecting personal profiles, and keeping audit logs.",
            ],
            [
              { term: "Consent" },
              ": where Nigerian law requires consent for a specific optional feature or future non-essential cookie, we will obtain your clear consent first.",
            ],
          ],
        },
      ],
    },
    {
      id: "service-providers",
      title: "Recipients and Service Providers",
      blocks: [
        {
          type: "paragraph",
          text: "Affilova never sells Personal Data. We share Personal Data strictly as needed with vetted third-party processors who act on our instructions:",
        },
        {
          type: "list",
          items: [
            "Paystack — checkout payment processing, card/bank authorisation, refunds, and Vendor/Affiliate bank payout verification and transfers.",
            "Supabase — database hosting, user authentication, and access control.",
            "Brevo — sending transactional emails such as purchase receipts, download links, password resets, and policy notices.",
            "Cloudflare Turnstile — bot verification challenges on sign-up and checkout forms.",
            "Vercel — web application hosting and edge routing.",
            "Upstash — distributed rate limiting to prevent abuse.",
            "Sentry — crash and error monitoring, configured with personal data, cookies, and session replay switched off.",
            "Cloudinary — hosting and optimising product listing images.",
            "Malware scanning provider — automated security scanning of uploaded Vendor product files before publication.",
          ],
        },
      ],
    },
    {
      id: "international-transfers",
      title: "International Data Transfers",
      blocks: [
        {
          type: "clauses",
          items: [
            "Several of the infrastructure providers listed above operate servers outside Nigeria.",
            "Where Personal Data is transferred outside Nigeria, Affilova relies on lawful transfer mechanisms and safeguards recognised under the NDPA to ensure an adequate level of protection.",
          ],
        },
      ],
    },
    {
      id: "retention",
      title: "How Long We Keep Data",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Account and profile data" },
              ": kept while your account remains active and for as long as needed afterwards to comply with legal obligations or resolve disputes.",
            ],
            [
              { term: "Financial, order, refund, and payout records" },
              ": kept for at least 6 years to satisfy Nigerian tax, accounting, and audit requirements.",
            ],
            [
              { term: "Affiliate click records" },
              ": purged automatically after 13 months. Aggregated daily statistics without personal identifiers may be retained longer.",
            ],
            [
              { term: "Webhook delivery, rate-limit, and security logs" },
              ": kept for 30 to 90 days as implemented in our cleanup schedule before automatic deletion.",
            ],
          ],
        },
      ],
    },
    {
      id: "security",
      title: "How We Protect Your Data",
      blocks: [
        {
          type: "clauses",
          items: [
            "All connections to Affilova use HTTPS encryption in transit, and passwords are stored as salted cryptographic hashes.",
            "Product files are stored in private non-public storage and delivered only through short-lived signed links that expire automatically.",
            "Payment card details go directly to Paystack and never touch Affilova's servers or logs.",
            "Database tables enforce strict row-level access controls, and all sensitive mutations run through server-side functions with audit logging.",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      title: "Your Rights Under the NDPA",
      blocks: [
        {
          type: "clauses",
          items: [
            "You have the right to request access to the Personal Data we hold about you and receive a copy.",
            "You have the right to ask us to correct inaccurate or incomplete data, or to delete Personal Data where there is no legal reason to retain it (for instance, statutory tax records cannot be erased early).",
            "You have the right to restrict or object to certain processing, to request data portability in a structured electronic format, and to withdraw consent where processing is based on consent.",
            "You also have the right to lodge a complaint with the Nigeria Data Protection Commission (NDPC) if you believe your data rights have been infringed.",
            [
              "To exercise any of these rights, contact us via our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              ". We may ask you to verify your identity before acting on a request.",
            ],
          ],
        },
      ],
    },
    {
      id: "automated-decisions",
      title: "Automated Checks and Human Review",
      blocks: [
        {
          type: "clauses",
          items: [
            "Affilova uses automated rules to flag bot traffic, rate-limit abuse, malware uploads, and potential payment fraud.",
            "Account-level enforcement decisions triggered by fraud flags are reviewed by human staff. If you believe an automated check affected you unfairly, contact us for a manual review.",
          ],
        },
      ],
    },
    {
      id: "breach-notification",
      title: "Data Breach Notification",
      blocks: [
        {
          type: "clauses",
          items: [
            "If a personal data breach occurs that is likely to result in a risk to individuals' rights and freedoms, Affilova will notify the Nigeria Data Protection Commission within 72 hours of becoming aware of it, in line with the NDPA.",
            "Where a breach poses a high risk to affected users, we will also notify those users without undue delay with practical guidance on protective steps.",
          ],
        },
      ],
    },
    {
      id: "children",
      title: "Children's Privacy",
      blocks: [
        {
          type: "clauses",
          items: [
            "Affilova is intended only for adults aged 18 and over. We do not knowingly collect Personal Data from anyone under 18. If we learn that a minor has created an account or provided Personal Data, we will close the account and delete the data where legally permitted.",
          ],
        },
      ],
    },
    {
      id: "changes-and-contact",
      title: "Changes to This Policy and Contact",
      blocks: [
        {
          type: "clauses",
          items: [
            "If we make material changes to this Privacy Policy, we will notify users by email and publish a notice on Affilova at least 14 days before the changes take effect.",
            [
              "Questions or requests: use our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              LEGAL.dataProtectionContact !== ""
                ? ` or email ${LEGAL.dataProtectionContact}`
                : "",
              ".",
            ],
          ],
        },
      ],
    },
  ],
}
