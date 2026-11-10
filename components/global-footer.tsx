"use client"

import Link from "next/link"

interface FooterProps {
  className?: string
}

export default function GlobalFooter({ className = "" }: FooterProps) {
  const footerLinks = {
    products: [
      { name: "How It Works", href: "/how-it-works" },
      { name: "Features", href: "/features" },
      { name: "Pricing", href: "/pricing" },
      { name: "Affiliates", href: "/affiliates" },
      { name: "Sell Courses", href: "/sell-courses" },
      { name: "Show Love", href: "/show-love" },
      { name: "Tickets", href: "/tickets" },
      { name: "Integrations", href: "/integrations" },
      { name: "Affiliate Network", href: "/affiliate-network" },
    ],
    support: [
      { name: "Blog", href: "/blog" },
      { name: "Help Center", href: "/help" },
      { name: "Creator Academy", href: "/creator-academy" },
      { name: "Free Canva Templates", href: "/templates" },
      { name: "Press & Media", href: "/press" },
      { name: "FAQs", href: "/faqs" },
      { name: "Reach Us", href: "/contact" },
    ],
    legal: [
      { name: "Privacy Policy", href: "/privacy-policy" },
      { name: "Terms of Service", href: "/terms-of-service" },
    ],
  }

  return (
    <footer className={`border-t bg-white py-12 ${className}`}>
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center space-x-2 mb-4">
              <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto" />
              <span className="font-bold text-xl text-gray-900">Affilova</span>
            </Link>
            <p className="text-sm text-gray-600 mb-4">
              The premier affiliate marketplace connecting vendors and affiliates worldwide.
            </p>
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Products</h3>
            <ul className="space-y-2">
              {footerLinks.products.slice(0, 5).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* More Products */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">More</h3>
            <ul className="space-y-2">
              {footerLinks.products.slice(5).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider">Support & Resources</h3>
            <ul className="space-y-2">
              {footerLinks.support.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Legal Links & Copyright */}
        <div className="border-t pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            {footerLinks.legal.map((link) => (
              <Link key={link.href} href={link.href} className="text-gray-600 hover:text-green-600 transition-colors">
                {link.name}
              </Link>
            ))}
          </div>
          <div className="text-center md:text-right text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} Affilova. All rights reserved.</p>
            <p className="text-xs mt-1">
              Powered by <span className="font-semibold text-gray-700">Wisdom Technologies®</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
