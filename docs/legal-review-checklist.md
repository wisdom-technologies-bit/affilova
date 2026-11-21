# Legal Review Checklist (Draft Pending Counsel Review)

This checklist summarises every legal position drafted in `content/legal/*.ts` for review by Nigerian legal counsel, together with the empty company placeholders in `lib/site-config.ts` that require owner input before switching `POLICY_STATUS` from `"draft"` to `"final"`.

## 1. Empty Placeholders and Draft Constants in `lib/site-config.ts`

- `LEGAL.entityName` (`""`) — Full registered legal entity name (e.g. CAC-registered Ltd company).
- `LEGAL.registeredAddress` (`""`) — Registered Nigerian office address.
- `LEGAL.registrationNumber` (`""`) — CAC RC/BN registration number.
- `LEGAL.dataProtectionContact` (`""`) — Dedicated privacy/DPO email or contact point under NDPA 2023.
- `LEGAL.supportEmail` (`""`) — Public support email address (currently using `LEGAL.contactPath = "/contact"`).
- `POLICY_STATUS` (`"draft"`) — Flip to `"final"` only after Nigerian legal counsel approves all documents.
- `POLICY_VERSIONS` (`"draft-2026-11-21"` across all 9 keys) — Bump to dated final version strings upon sign-off.
- Commercial figures to confirm with owner before publication: `PLATFORM_FEE_PERCENT` (`10`), `WITHDRAWAL_FEE` (`2%`, min `₦50`, cap `₦2,000`), `MIN_WITHDRAWAL_NAIRA` (`₦5,000`), `COMMISSION_HOLD_DAYS` (`7`), `MIN_REFUND_WINDOW_HOURS` (`24`), `COMMISSION_RANGE_PERCENT` (`5%`–`80%`), `PAYOUT_DAYS_TEXT` (`"Monday to Friday"`).

## 2. Legal Positions for Nigerian Counsel Confirmation

### Terms of Service (`/terms-of-service`)
- Minimum age of 18 and legal capacity under Nigerian law — `/terms-of-service`, Clause 1.4.
- Marketplace intermediary status (Affilova is not the seller, author, or publisher of Vendor products) — `/terms-of-service`, Clauses 2.2–2.4.
- Platform fee (10%) and Vendor-set commission range (5%–80%) deducted from sale price — `/terms-of-service`, Clauses 4.1–4.2.
- Affilova absorbs Paystack checkout processing fees; payout withdrawal fee is 2% (min ₦50, max ₦2,000) — `/terms-of-service`, Clauses 4.3–4.4.
- Advance notice of 14 days for non-retroactive fee changes — `/terms-of-service`, Clause 4.5.
- Tax self-reporting by Vendors/Affiliates and VAT withholding/remittance where required by Nigerian law — `/terms-of-service`, Clause 4.6.
- Hold window (7 days), refund/chargeback reversals even post-payout, and negative balance recovery from future earnings — `/terms-of-service`, Clauses 5.1–5.3.
- NGN-only payouts to verified Nigerian bank accounts, ₦5,000 minimum threshold, Monday–Friday automatic/manual payout schedule, and payout holds for fraud/disputes — `/terms-of-service`, Clauses 5.4–5.7.
- Vendor content hosting/scanning licence and Buyer personal, non-transferable download licence — `/terms-of-service`, Clauses 6.2–6.3.
- Automated third-party malware scanning and quarantine of uploaded digital files — `/terms-of-service`, Clauses 7.1–7.3.
- Immediate suspension/termination grounds and surviving clauses (fees, reversals, negative balances, indemnity, liability, disputes) — `/terms-of-service`, Clauses 8.2–8.3.
- Exclusion of indirect/consequential losses and 12-month platform-fee liability cap, preserving non-excludable statutory liabilities — `/terms-of-service`, Clauses 9.2–9.4.
- User indemnity for uploaded products, promotions, legal breaches, and IP infringement — `/terms-of-service`, Clause 10.1.
- Nigerian governing law, 30-day good-faith written negotiation, and Lagos State courts (with optional written arbitration) — `/terms-of-service`, Clauses 11.1–11.3.
- 14-day advance notice for material Terms updates, severability, entire agreement, assignment, force majeure, and no waiver — `/terms-of-service`, Clauses 12.1–12.8.

### Privacy Policy (`/privacy-policy`)
- Data controller identification under the Nigeria Data Protection Act 2023 (NDPA) — `/privacy-policy`, Clauses 1.1–1.2.
- Categories of personal data collected (auth/account, role profiles, Paystack bank verification, order data, support tickets, daily-rotating IP/user-agent hashes) — `/privacy-policy`, Clauses 2.1–2.6.
- NDPA lawful bases (contract performance, legal obligations, legitimate interests, consent) — `/privacy-policy`, Clauses 3.1–3.4.
- Named infrastructure and service providers (Paystack, Supabase, Brevo, Cloudflare Turnstile, Vercel, Upstash, Sentry without PII/cookies, Cloudinary, malware scanner) — `/privacy-policy`, Section 4.
- Cross-border transfers outside Nigeria using NDPA-compliant safeguards — `/privacy-policy`, Clauses 5.1–5.2.
- Retention schedule (account lifetime + statutory needs, 6-year Nigerian financial/tax records, 13-month affiliate click purge, 30–90 day security/webhook logs) — `/privacy-policy`, Clauses 6.1–6.4.
- Technical security measures (HTTPS, salted hashes, private file storage with short-lived signed URLs, Paystack card isolation, RLS + server-side RPCs) — `/privacy-policy`, Clauses 7.1–7.4.
- Data subject rights (access, correction, deletion, restriction/objection, portability, NDPC complaint right) — `/privacy-policy`, Clauses 8.1–8.5.
- Automated fraud/malware checks paired with human review for account enforcement — `/privacy-policy`, Clauses 9.1–9.2.
- 72-hour NDPC breach notification obligation and user notification for high-risk breaches — `/privacy-policy`, Clauses 10.1–10.2.
- Adults-only (18+) data restriction and 14-day material change notice — `/privacy-policy`, Clauses 11.1, 12.1.

### Refund Policy (`/refund-policy`)
- Mandatory Vendor-set Refund Window of at least 24 hours shown before checkout — `/refund-policy`, Clauses 1.1–1.2.
- Automatic approval within Refund Window; Vendor decision after window; Affilova override for malware, non-delivery, or material misdescription — `/refund-policy`, Clauses 2.1–2.3.
- Refund request workflow via order access link, resend page, or signed-in orders page — `/refund-policy`, Clauses 3.1–3.3.
- Refunds returned via Paystack with immediate download revocation and Vendor/Affiliate reversal — `/refund-policy`, Clauses 4.1–4.3.
- Chargeback access suspension and earnings reversal on successful chargebacks — `/refund-policy`, Clauses 5.1–5.3.
- Suspension of automatic refunds or accounts for serial refund abuse — `/refund-policy`, Clauses 6.1–6.2.

### Acceptable Use and Prohibited Products Policy (`/acceptable-use`)
- Scope covering Vendors, Affiliates, Buyers, and general site visitors — `/acceptable-use`, Clauses 1.1–1.2.
- Prohibited categories (illegal goods, piracy, adult content, hate/violence, scams, get-rich-quick/gambling, unlicensed medical/financial/legal advice, malware/hacking tools, weapons/drugs, physical goods, impersonation) — `/acceptable-use`, Clauses 2.1–2.11.
- Technical file bans (no executables, no encrypted/password-protected archives, 25 MB per-file upload cap) — `/acceptable-use`, Clauses 3.1–3.3.
- Prohibition of fake reviews, wash trading, self-referrals, and traffic/cookie manipulation — `/acceptable-use`, Clauses 4.1–4.4.
- Pre-listing moderation, malware scanning, listing rejection/unpublishing, and account termination — `/acceptable-use`, Clauses 5.1–5.3.

### Vendor Agreement (`/vendor-agreement`)
- Independent seller eligibility (18+, verified Nigerian bank account, real business/support details) — `/vendor-agreement`, Clauses 1.1–1.2.
- Vendor ownership warranties, accuracy of listing claims, and non-infringement — `/vendor-agreement`, Clauses 2.1–2.3.
- Platform-only delivery and ban on off-platform checkout redirection — `/vendor-agreement`, Clauses 3.1–3.3.
- Buyer email restriction (no direct Buyer email harvesting; NDPA compliance when Buyers initiate support) — `/vendor-agreement`, Clauses 4.1–4.2.
- Minimum 24-hour Refund Window, automatic in-window refunds, and post-window/policy-breach obligations — `/vendor-agreement`, Clauses 5.1–5.3.
- 10% platform fee, 5%–80% Affiliate commission deduction, 7-day hold, Monday–Friday ₦5,000+ payouts with 2% (₦50–₦2,000) fee, and negative balance recovery — `/vendor-agreement`, Clauses 6.1–6.5.
- Affiliate join-mode controls, blocking Affiliates (disabling links), and forward-only commission rate changes — `/vendor-agreement`, Clauses 7.1–7.3.
- Two-strike automatic suspension for infected file uploads within rolling 30 days (or immediate suspension for deliberate malware) — `/vendor-agreement`, Clauses 8.1–8.3.
- Vendor indemnity and payout of cleared post-termination balances subject to dispute/legal holds — `/vendor-agreement`, Clauses 9.1–9.3.

### Affiliate Agreement (`/affiliate-agreement`)
- Independent contractor status (no employment/agency/partnership authority) and 18+ / bank verification eligibility — `/affiliate-agreement`, Clauses 1.1–1.3.
- Last-click per-product 30-day attribution (`afv_ref`), Vendor-set 5%–80% commission, and single-level rule (no recruitment overrides/MLM) — `/affiliate-agreement`, Clauses 2.1–2.4.
- 7-day commission hold, refund/chargeback clawbacks with negative balance recovery, and Monday–Friday ₦5,000+ payouts with 2% (₦50–₦2,000) fee — `/affiliate-agreement`, Clauses 3.1–3.3.
- Strict ban on self-referrals and commissions on own-controlled accounts — `/affiliate-agreement`, Clauses 4.1–4.2.
- Prohibited promotion rules (no spam, false earnings claims, impersonation, forced/incentivised clicks, adult/illegal sites, misleading brand bidding) — `/affiliate-agreement`, Clauses 5.1–5.6.
- Mandatory clear pre-click affiliate commission disclosure — `/affiliate-agreement`, Clauses 6.1–6.2.
- Affiliate sole responsibility for channel rules and income taxes — `/affiliate-agreement`, Clauses 7.1–7.2.
- Fraud/material-breach termination and forfeiture of pending or fraudulent commissions — `/affiliate-agreement`, Clauses 8.1–8.2.

### Cookie Policy (`/cookie-policy`)
- First-party strictly necessary session/security cookies only — `/cookie-policy`, Clauses 1.1–2.2.
- `afv_ref` affiliate attribution cookie disclosure (up to 20 recent product links, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry, daily-hashed IP + 13-month click retention) — `/cookie-policy`, Clauses 3.1–3.4.
- Cloudflare Turnstile bot verification and PII-free/cookie-free Sentry diagnostics — `/cookie-policy`, Clauses 4.1–4.2.
- Absence of third-party ad/tracking cookies and commitment to add consent controls before introducing optional cookies — `/cookie-policy`, Clauses 5.1–5.3.

### Copyright and Takedown Policy (`/copyright`)
- Vendor IP warranty and takedown request requirements — `/copyright`, Clauses 1.1–2.6.
- Prompt removal/disabling on valid notice and Vendor notification — `/copyright`, Clauses 3.1–3.3.
- Counter-notice procedure with 10-business-day claimant court-action window and Lagos State jurisdiction consent — `/copyright`, Clauses 4.1–4.3.
- Repeat-infringer termination and liability/sanctions for false notices — `/copyright`, Clauses 5.1–5.2.

### Earnings Disclaimer (`/earnings-disclaimer`)
- Explicit no-guarantee disclaimer for Vendor sales and Affiliate commissions — `/earnings-disclaimer`, Clauses 1.1–1.2.
- Fee/commission figures presented strictly as mathematical illustrations, not forecasts — `/earnings-disclaimer`, Clauses 2.1–2.2.
- External market/product factors determining results and non-reliance on past performance — `/earnings-disclaimer`, Clauses 3.1–3.2.
- Disclaimer of financial, investment, tax, legal, or business advice — `/earnings-disclaimer`, Clauses 4.1–4.2.
