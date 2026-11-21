import { LEGAL, POLICY_VERSIONS } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

export const acceptableUseDocument: LegalDocumentData = {
  key: "acceptable_use",
  slug: "acceptable-use",
  href: "/acceptable-use",
  title: "Acceptable Use and Prohibited Products Policy",
  description:
    "Products, file types, promotional behaviour and platform abuse rules that apply to all Vendors, Affiliates, Buyers and visitors.",
  version: POLICY_VERSIONS.acceptable_use,
  effectiveDate: "2026-11-21",
  summary: [
    "Affilova allows lawful digital products only; physical shipping goods and illegal items are banned.",
    "Piracy, adult content, scams, gambling, get-rich-quick schemes and unlicensed medical or financial advice are prohibited.",
    "Executable files, encrypted or password-protected archives, and files over 25 MB are blocked.",
    "Fake reviews, wash sales, self-referrals, cookie stuffing and bot traffic lead to removal and bans.",
    "Every listing is reviewed before going live, and every uploaded file is scanned for malware.",
  ],
  sections: [
    {
      id: "scope",
      title: "Who This Policy Applies To",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "This ",
              { term: "Acceptable Use and Prohibited Products Policy" },
              " (",
              { term: "Acceptable Use Policy" },
              ") applies to every Vendor, Affiliate, Buyer, and visitor using Affilova.",
            ],
            [
              "If you list, promote, or buy a product, or interact with any part of the platform, you must follow these rules alongside our ",
              { link: { label: "Terms of Service", href: "/terms-of-service" } },
              ".",
            ],
          ],
        },
      ],
    },
    {
      id: "prohibited-products",
      title: "Prohibited Products and Content",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Illegal products and services" },
              ": anything unlawful to sell, possess, distribute, or promote under Nigerian law or applicable international law.",
            ],
            [
              { term: "Counterfeit, pirated, or infringing content" },
              ": cracked software, leaked courses, unauthorised copies, or material violating copyright, trademarks, or privacy rights.",
            ],
            [
              { term: "Adult or sexual content" },
              ": pornography, sexually explicit media, escorting, or adult services.",
            ],
            [
              { term: "Violence, hatred, or discrimination" },
              ": material that promotes violence, terrorism, harassment, abuse, or hatred against any person or group.",
            ],
            [
              { term: "Fraud, scams, and deception" },
              ": phishing kits, identity theft guides, forged documents, or deceptive offers.",
            ],
            [
              { term: "Get-rich-quick, investment schemes, and gambling" },
              ": offers promising guaranteed income or returns, unlicensed investment or Ponzi schemes, crypto hype schemes, or gambling and betting products.",
            ],
            [
              { term: "Unlicensed regulated advice and medical cures" },
              ": unlicensed financial, investment, medical, or legal advice, or products claiming to cure, treat, or diagnose medical conditions without lawful authorisation.",
            ],
            [
              { term: "Malware, hacking, and surveillance tools" },
              ": viruses, ransomware, spyware, stalkerware, exploit kits, credential dumps, or tools designed for unauthorised access.",
            ],
            [
              { term: "Weapons, drugs, and regulated goods" },
              ": firearms, ammunition, explosives, controlled drugs, or other regulated items.",
            ],
            [
              { term: "Physical goods" },
              ": Affilova is strictly for downloadable digital products; physical items requiring shipping are not supported.",
            ],
            [
              { term: "Impersonation" },
              ": pretending to be Affilova, another Vendor, a public figure, or any brand without authorisation.",
            ],
          ],
        },
      ],
    },
    {
      id: "prohibited-file-types",
      title: "Prohibited File Formats and Technical Limits",
      blocks: [
        {
          type: "clauses",
          items: [
            "Executable files are not accepted: programs, installers, runnable binaries, and executable scripts are prohibited.",
            "Encrypted or password-protected archives are not accepted because they prevent malware scanning.",
            "Files larger than the platform upload limit of 25 MB per file are rejected before upload.",
          ],
        },
      ],
    },
    {
      id: "platform-manipulation",
      title: "Prohibited Manipulation and Abuse",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Fake reviews or testimonials" },
              ": inventing buyer reviews, endorsements, or results.",
            ],
            [
              { term: "Fake sales or wash trading" },
              ": placing artificial orders to inflate sales numbers or launder funds.",
            ],
            [
              { term: "Self-referral" },
              ": buying a product through your own affiliate link or through any account you own or control to earn commission.",
            ],
            [
              { term: "Traffic and tracking abuse" },
              ": bot clicks, automated form submissions, cookie stuffing, hidden redirects, or attempts to bypass security and rate limits.",
            ],
          ],
        },
      ],
    },
    {
      id: "enforcement",
      title: "Review and Enforcement",
      blocks: [
        {
          type: "clauses",
          items: [
            "Pre-listing review: every product goes through review before appearing in the marketplace.",
            "Automated malware scanning: every uploaded file is scanned by our malware-scanning partner, and infected files are quarantined.",
            "Actions we may take: if a listing, file, or account breaches this policy, Affilova may reject or unpublish the product, withhold or reverse payouts, suspend or terminate accounts, and report unlawful activity to authorities.",
          ],
        },
      ],
    },
    {
      id: "reporting-violations",
      title: "How to Report a Product or Violation",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "If you see a prohibited product, scam, malware risk, or policy breach, report it through our ",
              { link: { label: "Contact page", href: LEGAL.contactPath } },
              " with the product URL and details.",
            ],
            [
              "To report copyright or trademark infringement, follow the notice procedure in our ",
              { link: { label: "Copyright and Takedown Policy", href: "/copyright" } },
              ".",
            ],
          ],
        },
      ],
    },
  ],
}
