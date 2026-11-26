import Link from "next/link"

import GlobalFooter from "@/components/global-footer"
import { Logo } from "@/components/brand/logo"
import {
  COMMISSION_HOLD_DAYS,
  COMMISSION_RANGE_PERCENT,
  MIN_REFUND_WINDOW_HOURS,
  MIN_WITHDRAWAL_NAIRA,
  PAYOUT_DAYS_TEXT,
  PLATFORM_FEE_PERCENT,
  WITHDRAWAL_FEE,
  formatNairaWhole,
} from "@/lib/site-config"

// The public explanation of the product. Every statement here describes
// something the app does today; nothing on this page promises a feature, a
// payout schedule, a statistic or a figure that is not in the code.

const NAV_LINKS = [
  { name: "How It Works", href: "/how-it-works" },
  { name: "About", href: "/about" },
  { name: "Contact", href: "/contact" },
]

const ROLES = [
  {
    title: "For vendors",
    summary: "List a product and let affiliates sell it for you.",
    steps: [
      "Create an account and set up your store: a business name and a store address that becomes your public store link.",
      "Add a product with a title, description, price, category, image, commission rate and the file your customer receives.",
      "Submit the product for review. Once it is approved, it appears in the marketplace.",
      "Approve the affiliates who apply to promote it, or switch on automatic approval, then follow sales and commissions in your dashboard.",
    ],
  },
  {
    title: "For affiliates",
    summary: "Promote products from the marketplace and earn a commission on the sales you bring in.",
    steps: [
      "Create an account, choose a username and tell us where you promote.",
      "Browse the marketplace and apply to promote the products you want.",
      "When a vendor approves you, the product is added to your approved products and your sales are recorded against your account.",
      "Follow your commissions in your dashboard and request a withdrawal to your bank account.",
    ],
  },
  {
    title: "For customers",
    summary: "Buy from vendors on Affilova, with payment handled by our payment partner.",
    steps: [
      "Open a product page from the marketplace or from a vendor's sales page.",
      "Enter your details and pay at checkout through our payment partner.",
      "After payment you land on a confirmation page with your download or delivery details and a receipt.",
    ],
  },
]

const FAQ = [
  {
    question: "What does Affilova charge?",
    answer: `Affilova takes a ${PLATFORM_FEE_PERCENT}% platform fee from each completed sale.`,
  },
  {
    question: "Who sets the commission an affiliate earns?",
    answer: `The vendor, per product, from ${COMMISSION_RANGE_PERCENT.min}% to ${COMMISSION_RANGE_PERCENT.max}%. The commission rate is set when the product is added and is shown on the product's listing page.`,
  },
  {
    question: "How does an affiliate get paid?",
    answer: `Commissions are held for ${COMMISSION_HOLD_DAYS} days after a sale to cover refunds and disputes. Once available, withdrawals start at ${formatNairaWhole(MIN_WITHDRAWAL_NAIRA)} (with a ${WITHDRAWAL_FEE.percent}% transfer fee, minimum ${formatNairaWhole(WITHDRAWAL_FEE.minNaira)}, capped at ${formatNairaWhole(WITHDRAWAL_FEE.capNaira)}) and are processed ${PAYOUT_DAYS_TEXT} to a saved bank account.`,
  },
  {
    question: "How do refunds work?",
    answer: `Every product has a refund window of at least ${MIN_REFUND_WINDOW_HOURS} hours set by the vendor. Approved refunds are returned to the buyer and any associated commission is reversed.`,
  },
  {
    question: "Why does a product go through review?",
    answer:
      "Products are reviewed before they appear in the marketplace. A vendor can edit a product and resubmit it if it is not approved.",
  },
  {
    question: "Can one account sell and promote?",
    answer:
      "Yes. An account can sell products, promote products, or do both, and each part is set up separately.",
  },
  {
    question: "How do I get help?",
    answer: "Send a support ticket from the contact page and it reaches us directly.",
  },
]

export default function HowItWorksClient() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#E3E6E3]">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" aria-label="Affilova home" className="inline-flex">
            <Logo variant="horizontal" className="h-8 w-auto" />
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.href === "/how-it-works" ? "page" : undefined}
                className={`rounded-md px-3 py-2 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                  link.href === "/how-it-works" ? "font-medium text-brand-700" : "text-slate-600"
                }`}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-2 text-slate-700 transition-colors duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-brand-500 px-4 py-2 font-medium text-white transition-colors duration-150 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6">
        {/* What Affilova is */}
        <section className="py-14 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">How it works</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            How Affilova works
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
            Affilova is a marketplace where vendors sell digital products and affiliates earn a commission on the
            sales they refer. Vendors set up a store and list products, affiliates apply to promote them, and
            customers buy through a hosted checkout with our payment partner.
          </p>
        </section>

        {/* The three roles */}
        <div className="space-y-4">
          {ROLES.map((role) => (
            <section key={role.title} className="rounded-xl border border-[#E3E6E3] p-6 sm:p-8">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{role.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{role.summary}</p>
              <ol className="mt-6 space-y-4">
                {role.steps.map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-slate-700">{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        {/* Fees */}
        <section className="mt-4 rounded-xl border border-[#E3E6E3] bg-[#F7F8F7] p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Fees</h2>
          <p className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight text-slate-900">{PLATFORM_FEE_PERCENT}%</span>
            <span className="text-sm text-slate-600">platform fee on each completed sale</span>
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Affilova takes the platform fee above from every completed sale. The affiliate commission is set by
            the vendor separately for each product (between {COMMISSION_RANGE_PERCENT.min}% and{" "}
            {COMMISSION_RANGE_PERCENT.max}%), so the rate is different from product to product. Both are taken
            from the sale price, and the vendor keeps the rest. Commissions clear after a{" "}
            {COMMISSION_HOLD_DAYS}-day hold period, and withdrawals start at{" "}
            {formatNairaWhole(MIN_WITHDRAWAL_NAIRA)} with a {WITHDRAWAL_FEE.percent}% payout fee (minimum{" "}
            {formatNairaWhole(WITHDRAWAL_FEE.minNaira)}, capped at {formatNairaWhole(WITHDRAWAL_FEE.capNaira)}),
            processed {PAYOUT_DAYS_TEXT}.
          </p>
        </section>

        {/* FAQ */}
        <section className="py-14 sm:py-16">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Questions</h2>
          <div className="mt-6 divide-y divide-[#E3E6E3] border-y border-[#E3E6E3]">
            {FAQ.map((item) => (
              <details key={item.question} className="group py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium text-slate-900 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="text-lg leading-none text-brand-600 transition-transform duration-150 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Call to action */}
        <section className="pb-16">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-brand-500 px-5 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Sell on Affilova
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md border border-[#E3E6E3] px-5 py-3 text-sm font-medium text-slate-900 transition-colors duration-150 hover:border-brand-500 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Promote on Affilova
            </Link>
          </div>
        </section>
      </main>

      <GlobalFooter />
    </div>
  )
}
