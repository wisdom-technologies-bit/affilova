"use client"

import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import GlobalFooter from "@/components/global-footer" // Import GlobalFooter component
import {
  Users,
  TrendingUp,
  Shield,
  Zap,
  CheckCircle,
  ArrowRight,
  Menu,
  X,
} from "lucide-react"
import { Logo } from "@/components/brand/logo"

export default function HomePageClient() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrollY, setScrollY] = useState(0)

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const scrollToSection = (sectionId: string) => {
    setMobileMenuOpen(false)
    const element = document.getElementById(sectionId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Header */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${scrollY > 50 ? "bg-white shadow-lg" : "bg-white border-b border-gray-100"}`}
      >
        <div className="container mx-auto px-4 h-16 md:h-20 flex justify-between items-center">
          <Link href="/" className="flex items-center group">
            <Logo variant="horizontal" className="h-8 md:h-10 w-auto" />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-1">
            <button
              onClick={() => scrollToSection("features")}
              className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("how-it-works")}
              className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors"
            >
              How It Works
            </button>
            <Link
              href="/privacy-policy"
              className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors text-sm"
            >
              Privacy
            </Link>
            <Link
              href="/terms-of-service"
              className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors text-sm"
            >
              Terms
            </Link>
          </nav>

          {/* Desktop Auth Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            <Link href="/sign-in">
              <Button variant="ghost" className="text-gray-900 hover:text-green-600">
                Sign In
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button className="bg-green-600 hover:bg-green-700 text-white">Get Started</Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-gray-100 px-4 py-4 space-y-3 animate-in">
            <button
              onClick={() => scrollToSection("features")}
              className="block w-full text-left px-4 py-2 text-gray-600 hover:bg-gray-50 rounded"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection("how-it-works")}
              className="block w-full text-left px-4 py-2 text-gray-600 hover:bg-gray-50 rounded"
            >
              How It Works
            </button>
            <Link href="/privacy-policy" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
              Privacy
            </Link>
            <Link href="/terms-of-service" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
              Terms
            </Link>
            <div className="border-t pt-3 space-y-2">
              <Link href="/sign-in" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Get Started
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section with Gradient */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-50 via-white to-blue-50" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-green-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" />
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-green-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse delay-2000" />

        <div className="relative container mx-auto px-4 py-20 md:py-32 lg:py-40">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-8 animate-in fade-in slide-in-from-left duration-700">
              <div>
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-gray-900 leading-tight mb-6 bg-gradient-to-r from-gray-900 via-green-700 to-gray-900 bg-clip-text text-transparent">
                  Sell with affiliates
                </h1>
              </div>
              <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
                List a product on Affilova, let affiliates apply to promote it, and follow every sale and commission
                from one dashboard.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/sign-up">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl transition-all"
                  >
                    Start Selling <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <Link href="/sign-up">
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full sm:w-auto border-2 border-green-600 text-green-600 hover:bg-green-50 bg-transparent"
                  >
                    Join as Affiliate
                  </Button>
                </Link>
              </div>
            </div>

            <div className="hidden md:block relative">
              <div className="relative w-full h-96 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl overflow-hidden group">
                <img
                  src="/professional-affiliate-marketing-dashboard-with-gr.jpg"
                  alt="Affilova Dashboard"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="text-center">
                    <Logo
                      variant="stacked"
                      tone="dark"
                      className="h-20 w-auto mx-auto mb-4 group-hover:scale-110 transition-transform duration-300 drop-shadow-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 py-20 md:py-32">
        <div className="text-center mb-16 space-y-4 animate-in fade-in duration-700">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900">Powerful Features</h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Everything you need to run a successful affiliate program and grow your business
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: Zap,
              title: "Product Setup",
              description:
                "Add a product with a title, price, commission rate, its own sales page and the file your customer receives.",
            },
            {
              icon: Users,
              title: "Affiliate Marketplace",
              description:
                "Affiliates browse the marketplace and apply to promote the products they want. Vendors approve each application.",
            },
            {
              icon: TrendingUp,
              title: "Dashboards",
              description:
                "Sales, commissions and product performance are listed in the vendor and affiliate dashboards.",
            },
            {
              icon: Shield,
              title: "Payments",
              description:
                "Checkout runs through our payment partner. Earnings are withdrawn from your dashboard to your bank account.",
            },
          ].map((feature, i) => (
            <div
              key={i}
              className="group p-6 rounded-xl border border-gray-100 hover:border-green-500 hover:shadow-lg transition-all duration-300 bg-white hover:bg-green-50 animate-in fade-in slide-in-from-bottom duration-700"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <feature.icon className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{feature.title}</h3>
              <p className="text-gray-600 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-gray-50 py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16 space-y-4 animate-in fade-in duration-700">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900">How It Works</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">Get started in three simple steps</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              {
                step: "01",
                title: "Sign Up & Choose Role",
                description:
                  "Create an account as a vendor to sell, as an affiliate to promote, or set up both.",
              },
              {
                step: "02",
                title: "List & Apply",
                description:
                  "Vendors add products and submit them for review. Affiliates apply to the products they want to promote.",
              },
              {
                step: "03",
                title: "Sell & Get Paid",
                description:
                  "Follow sales and commissions in your dashboard, then request a withdrawal to your bank account.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="relative group animate-in fade-in slide-in-from-bottom duration-700"
                style={{ animationDelay: `${i * 150}ms` }}
              >
                <div className="absolute -inset-1 bg-gradient-to-r from-green-600 to-green-700 rounded-2xl opacity-0 group-hover:opacity-10 transition-all duration-300" />
                <div className="relative bg-white p-8 rounded-xl border border-gray-100 hover:border-green-500 transition-all">
                  <div className="text-5xl font-bold text-green-600 opacity-20 mb-4">{item.step}</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3">{item.title}</h3>
                  <p className="text-gray-600">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vendor Benefits */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 animate-in fade-in slide-in-from-left duration-700">
            <h2 className="text-4xl font-bold text-gray-900">For Vendors</h2>
            <p className="text-xl text-gray-600">
              Put your products in front of affiliates who sell them for a commission
            </p>

            <div className="space-y-4">
              {[
                "A public store page with its own address",
                "A sales page and thank-you page for each product",
                "A commission rate you set per product",
                "Approval of the affiliates who apply to promote",
                "Products reviewed before they reach the marketplace",
                "Sales and commissions listed in your dashboard",
              ].map((benefit, i) => (
                <div key={i} className="flex items-center gap-3 group cursor-pointer">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 group-hover:scale-125 transition-transform" />
                  <p className="text-gray-700 group-hover:text-green-600 transition-colors">{benefit}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative h-80 md:h-full min-h-96 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center overflow-hidden group">
            <img
              src="/vendor-dashboard-analytics-green-professional-inte.jpg"
              alt="Vendor Dashboard"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white opacity-50" />
            <div className="relative text-center space-y-4 z-10">
              <Zap className="w-16 h-16 text-white mx-auto group-hover:scale-110 transition-transform drop-shadow-lg" />
              <p className="text-white font-semibold drop-shadow">Vendor Dashboard</p>
            </div>
          </div>
        </div>
      </section>

      {/* Affiliate Benefits */}
      <section className="bg-gray-50 py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="relative h-80 md:h-full min-h-96 bg-gradient-to-br from-green-100 to-green-50 rounded-2xl flex items-center justify-center overflow-hidden group order-last md:order-first">
              <img
                src="/affiliate-dashboard-earnings-tracking-professional.jpg"
                alt="Affiliate Dashboard"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-l from-transparent to-white opacity-50" />
              <div className="relative text-center space-y-4 z-10">
                <TrendingUp className="w-16 h-16 text-white mx-auto group-hover:scale-110 transition-transform drop-shadow-lg" />
                <p className="text-white font-semibold drop-shadow">Affiliate Dashboard</p>
              </div>
            </div>

            <div className="space-y-6 animate-in fade-in slide-in-from-right duration-700">
              <h2 className="text-4xl font-bold text-gray-900">For Affiliates</h2>
              <p className="text-xl text-gray-600">
                Promote products you believe in and earn the commission each vendor sets
              </p>

              <div className="space-y-4">
                {[
                  "Browse the marketplace by category",
                  "Apply to the products you want to promote",
                  "Commissions set by each vendor, shown on the listing",
                  "Your approved products in one place",
                  "Sales and commissions listed in your dashboard",
                  "Withdrawals requested from your dashboard",
                ].map((benefit, i) => (
                  <div key={i} className="flex items-center gap-3 group cursor-pointer">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 group-hover:scale-125 transition-transform" />
                    <p className="text-gray-700 group-hover:text-green-600 transition-colors">{benefit}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-green-600 to-green-700 p-12 md:p-20 text-white">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white opacity-10 rounded-full -mr-48 -mt-48" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-white opacity-5 rounded-full -ml-36 -mb-36" />

          <div className="relative text-center max-w-3xl mx-auto space-y-8 animate-in fade-in duration-700">
            <h2 className="text-4xl md:text-5xl font-bold">Ready to Get Started?</h2>
            <p className="text-xl opacity-90">
              Set up a store to sell, or apply to promote products that are already listed.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-up">
                <Button size="lg" className="w-full sm:w-auto bg-white text-green-600 hover:bg-gray-100">
                  Start as Vendor
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button
                  size="lg"
                  className="w-full sm:w-auto border-2 border-white text-white hover:bg-green-700 bg-transparent"
                >
                  Join as Affiliate
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Global Footer */}
      <GlobalFooter className="bg-white text-gray-600" />
    </div>
  )
}
