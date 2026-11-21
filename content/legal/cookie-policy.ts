import { LEGAL, POLICY_VERSIONS } from "@/lib/site-config"

import type { LegalDocumentData } from "./types"

export const cookiePolicyDocument: LegalDocumentData = {
  key: "cookie_policy",
  slug: "cookie-policy",
  href: "/cookie-policy",
  title: "Cookie Policy",
  description:
    "How Affilova uses strictly necessary session, security and first-party afv_ref affiliate attribution cookies.",
  version: POLICY_VERSIONS.cookie_policy,
  effectiveDate: "2026-11-21",
  summary: [
    "Affilova uses strictly necessary first-party cookies only; we do not run third-party advertising cookies.",
    "Session and routing cookies keep signed-in users authenticated and protect forms.",
    "The first-party afv_ref cookie records up to 20 recent affiliate product clicks for 30 days using HttpOnly and SameSite=Lax.",
    "Cloudflare Turnstile stops bots and Sentry collects crash diagnostics without personal data or cookies.",
    "If Affilova ever adds optional non-essential cookies, we will ask for consent first.",
  ],
  sections: [
    {
      id: "what-cookies-are",
      title: "What Cookies Are",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "A ",
              { term: "Cookie" },
              " is a small text file stored by your browser when you visit a website.",
            ],
            "Affilova uses only first-party cookies and technical signals that are strictly necessary to run the marketplace securely and credit affiliate referrals accurately.",
          ],
        },
      ],
    },
    {
      id: "strictly-necessary-cookies",
      title: "Strictly Necessary Session and Security Cookies",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              { term: "Sign-in session cookies" },
              ": keep you signed in securely as you move between pages and dashboards.",
            ],
            [
              { term: "Security and routing cookies" },
              ": protect form submissions and preserve consistent app routing across sessions.",
            ],
          ],
        },
      ],
    },
    {
      id: "affiliate-attribution-cookie",
      title: "The Affiliate Attribution Cookie (afv_ref)",
      blocks: [
        {
          type: "clauses",
          items: [
            [
              "We use a first-party cookie called ",
              { term: "afv_ref" },
              " to remember which Affiliate shared the link you arrived through, so that sale can be credited to them.",
            ],
            "It holds an anonymous click reference for each product you visited, storing up to 20 recent product links.",
            "The cookie is readable only by Affilova (HttpOnly, SameSite=Lax, and Secure in production) and expires after 30 days.",
            "We do not store your IP address or your browser's full address in click records; we keep a daily-changing hash and the name of the website that referred you for up to 13 months.",
          ],
        },
      ],
    },
    {
      id: "bot-protection-and-monitoring",
      title: "Bot Protection and Error Monitoring",
      blocks: [
        {
          type: "clauses",
          items: [
            "Cloudflare Turnstile runs a verification challenge on sign-up and checkout forms to distinguish human visitors from automated bots.",
            "Sentry collects error and performance diagnostics so we can fix crashes. Personal user data, cookies, and session replay are switched off.",
          ],
        },
      ],
    },
    {
      id: "no-advertising-cookies",
      title: "No Advertising Cookies and Consent",
      blocks: [
        {
          type: "clauses",
          items: [
            "Affilova does not place third-party advertising, social-media retargeting, or cross-site behavioural tracking cookies on your device.",
            "No cookie consent banner is required while Affilova uses only strictly necessary cookies.",
            "If Affilova ever introduces optional analytics or non-essential cookies, we will update this Cookie Policy and display a cookie consent banner with clear category controls before any optional cookie is set.",
          ],
        },
      ],
    },
    {
      id: "managing-cookies",
      title: "How to Control Cookies",
      blocks: [
        {
          type: "clauses",
          items: [
            "You can view, block, or delete cookies through your web browser's privacy settings.",
            "If you block strictly necessary cookies, you may not be able to stay signed in, complete bot verification, or credit an Affiliate when purchasing.",
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
            "Material updates to this Cookie Policy will be notified on the site and by email at least 14 days before taking effect. For questions, reach us via our ",
            { link: { label: "Contact page", href: LEGAL.contactPath } },
            ".",
          ],
        },
      ],
    },
  ],
}
