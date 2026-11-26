"use client"

import Link from "next/link"
import { Logo } from "@/components/brand/logo"

interface FooterProps {
  className?: string
}

export default function GlobalFooter({ className = "" }: FooterProps) {
  // Every target here resolves to a page that exists. Add a link only when the
  // page it points at has been built.
  const footerLinks = {
    platform: [
      { name: "Marketplace", href: "/marketplace" },
      { name: "How It Works", href: "/how-it-works" },
      { name: "About", href: "/about" },
      { name: "Blog", href: "/blog" },
      { name: "Contact", href: "/contact" },
    ],
    account: [
      { name: "Sign In", href: "/auth/login" },
      { name: "Create an Account", href: "/auth/register" },
      { name: "Sell on Affilova", href: "/auth/register?role=vendor" },
      { name: "Promote on Affilova", href: "/auth/register?role=affiliate" },
    ],
    legal: [
      { name: "All Legal Policies", href: "/legal" },
      { name: "Terms of Service", href: "/terms-of-service" },
      { name: "Privacy Policy", href: "/privacy-policy" },
      { name: "Refund Policy", href: "/refund-policy" },
      { name: "Acceptable Use Policy", href: "/acceptable-use" },
      { name: "Vendor Agreement", href: "/vendor-agreement" },
      { name: "Affiliate Agreement", href: "/affiliate-agreement" },
      { name: "Cookie Policy", href: "/cookie-policy" },
      { name: "Copyright Policy", href: "/copyright" },
      { name: "Earnings Disclaimer", href: "/earnings-disclaimer" },
    ],
  }

  return (
    <footer className={`border-t bg-white py-12 ${className}`}>
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center mb-4">
              <Logo variant="horizontal" className="h-8 w-auto" />
            </Link>
            <p className="text-sm text-gray-600 mb-4">
              A marketplace where vendors sell products and affiliates earn a commission on the sales they refer.
            </p>
          </div>

          {/* Platform */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Platform</h3>
            <ul className="space-y-2">
              {footerLinks.platform.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Account</h3>
            <ul className="space-y-2">
              {footerLinks.account.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Legal</h3>
            <ul className="space-y-2">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-center md:text-left text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} Affilova. All rights reserved.</p>
          </div>
          <div className="text-center md:text-right text-sm text-gray-500">
            <p className="text-xs">
              Built by <span className="font-semibold text-gray-700">Wisdom Technologies&reg;</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
