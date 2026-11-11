"use client"

import Link from "next/link"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import GlobalFooter from "@/components/global-footer"
import {
  Users,
  TrendingUp,
  Shield,
  Zap,
  CheckCircle,
  ArrowRight,
  Menu,
  X,
  UserPlus,
  Upload,
  DollarSign,
  BarChart3,
  Link2,
  ShoppingCart,
  CreditCard,
  Bell,
  Settings,
  FileText,
  ImageIcon,
  Video,
  BookOpen,
  Headphones,
  Download,
  Mail,
  MessageSquare,
  Globe,
  Lock,
  Eye,
  MousePointer,
  Target,
  Award,
  Star,
  Heart,
  Share2,
  Clock,
  RefreshCw,
  PieChart,
  LineChart,
  Wallet,
  Building,
  Search,
  Filter,
  Tag,
  Percent,
  Package,
  AlertCircle,
  HelpCircle,
  Info,
  ChevronRight,
  Monitor,
  Smartphone,
  Tablet,
  Key,
  Fingerprint,
  ShieldCheck,
  UserCheck,
  BadgeCheck,
  CircleDollarSign,
  Banknote,
  Receipt,
  Calculator,
  Layers,
  List,
  LayoutDashboard,
  Megaphone,
  Lightbulb,
  Rocket,
  Sparkles,
  Flame,
  Square,
  Type,
  Heading1,
  Quote,
  Code,
  SlidersHorizontal,
  Cpu,
  Archive,
  Store,
  Plus,
  Instagram,
  Youtube,
  Twitter,
  Briefcase,
  Columns,
} from "lucide-react"
import { Logo } from "@/components/brand/logo"

export default function HowItWorksClient() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const [activeSection, setActiveSection] = useState("")

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY)

      // Track active section for table of contents
      const sections = document.querySelectorAll("section[id]")
      let current = ""
      sections.forEach((section) => {
        const sectionTop = section.getBoundingClientRect().top
        if (sectionTop < 200) {
          current = section.getAttribute("id") || ""
        }
      })
      setActiveSection(current)
    }
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

  const tableOfContents = [
    { id: "introduction", title: "Introduction to Affilova" },
    { id: "getting-started", title: "Getting Started" },
    { id: "account-setup", title: "Account Setup Guide" },
    { id: "vendor-guide", title: "Complete Vendor Guide" },
    { id: "affiliate-guide", title: "Complete Affiliate Guide" },
    { id: "product-management", title: "Product Management" },
    { id: "sales-pages", title: "Creating Sales Pages" },
    { id: "payment-processing", title: "Payment Processing" },
    { id: "analytics-tracking", title: "Analytics & Tracking" },
    { id: "marketing-strategies", title: "Marketing Strategies" },
    { id: "commission-structure", title: "Commission Structure" },
    { id: "payout-system", title: "Payout System" },
    { id: "security-compliance", title: "Security & Compliance" },
    { id: "advanced-features", title: "Advanced Features" },
    { id: "integrations", title: "Integrations" },
    { id: "mobile-app", title: "Mobile Experience" },
    { id: "support-resources", title: "Support & Resources" },
    { id: "success-stories", title: "Success Stories" },
    { id: "faq", title: "Frequently Asked Questions" },
    { id: "next-steps", title: "Next Steps" },
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Header */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${scrollY > 50 ? "bg-white shadow-lg" : "bg-white border-b border-gray-100"}`}
      >
        <div className="container mx-auto px-4 h-16 md:h-20 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-2 group">
            <Logo variant="horizontal" className="h-8 md:h-10 w-auto" />
            <span className="font-bold text-xl md:text-2xl bg-gradient-to-r from-green-600 to-green-700 bg-clip-text text-transparent">
              Affilova
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-1">
            <Link href="/" className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors">
              Home
            </Link>
            <Link href="/how-it-works" className="px-4 py-2 text-green-600 font-medium transition-colors">
              How It Works
            </Link>
            <Link href="/blog" className="px-4 py-2 text-gray-600 hover:text-green-600 transition-colors">
              Blog
            </Link>
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
            <Link href="/auth/login">
              <Button variant="ghost" className="text-gray-900 hover:text-green-600">
                Sign In
              </Button>
            </Link>
            <Link href="/auth/register">
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
          <div className="md:hidden bg-white border-b border-gray-100 px-4 py-4 space-y-3">
            <Link href="/" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
              Home
            </Link>
            <Link href="/how-it-works" className="block px-4 py-2 text-green-600 bg-green-50 rounded font-medium">
              How It Works
            </Link>
            <Link href="/blog" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
              Blog
            </Link>
            <div className="border-t pt-3 space-y-2">
              <Link href="/auth/login" className="block px-4 py-2 text-gray-600 hover:bg-gray-50 rounded">
                Sign In
              </Link>
              <Link
                href="/auth/register"
                className="block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Get Started
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-green-50 via-white to-blue-50 py-16 md:py-24">
        <div className="absolute top-0 right-0 w-96 h-96 bg-green-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20" />

        <div className="relative container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <Badge className="mb-6 bg-green-100 text-green-800 hover:bg-green-100">Comprehensive Guide</Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-gray-900 leading-tight mb-6">
              How Affilova Works
            </h1>
            <p className="text-lg md:text-xl text-gray-600 leading-relaxed mb-8 max-w-3xl mx-auto">
              Your complete guide to understanding every aspect of Affilova's affiliate marketing platform. From account
              creation to earning your first commission, we cover everything you need to know to succeed as a vendor or
              affiliate.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => scrollToSection("getting-started")}
              >
                Start Reading <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-green-600 text-green-600 hover:bg-green-50 bg-transparent"
                onClick={() => scrollToSection("vendor-guide")}
              >
                Jump to Vendor Guide
              </Button>
            </div>

            <div className="mt-12 flex items-center justify-center gap-8 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>30+ min read</span>
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                <span>20 sections</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>Updated Dec 2025</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content with Sidebar */}
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Sidebar - Table of Contents */}
          <aside className="lg:w-72 flex-shrink-0">
            <div className="lg:sticky lg:top-24 bg-gray-50 rounded-xl p-6">
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <List className="w-5 h-5" />
                Table of Contents
              </h3>
              <nav className="space-y-1 max-h-[60vh] overflow-y-auto">
                {tableOfContents.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-all ${
                      activeSection === item.id
                        ? "bg-green-100 text-green-700 font-medium"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-gray-400 mr-2">{String(index + 1).padStart(2, "0")}.</span>
                    {item.title}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 max-w-4xl">
            {/* Section 1: Introduction */}
            <section id="introduction" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <Info className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Introduction to Affilova</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Welcome to Affilova, Nigeria's premier affiliate marketing platform designed specifically for digital
                  product creators and affiliate marketers. Whether you're a seasoned entrepreneur looking to expand
                  your reach or a newcomer eager to start earning through affiliate marketing, Affilova provides all the
                  tools, resources, and support you need to succeed.
                </p>

                <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-2xl p-8 my-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">What is Affilova?</h3>
                  <p className="mb-4">
                    Affilova is a comprehensive affiliate marketplace that connects vendors (product creators) with
                    affiliates (promoters) in a seamless ecosystem. Our platform handles everything from product hosting
                    and sales page creation to payment processing and commission distribution.
                  </p>
                  <p>
                    Think of us as your complete business partner—we provide the infrastructure, you provide the
                    products or promotional efforts, and together we create a thriving marketplace where everyone wins.
                  </p>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">The Affilova Ecosystem</h3>

                <p className="mb-6">
                  Our ecosystem is built on three fundamental pillars that work together to create a sustainable and
                  profitable environment for all participants:
                </p>

                <div className="grid md:grid-cols-3 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                      <Store className="w-6 h-6 text-blue-600" />
                    </div>
                    <h4 className="font-bold text-gray-900 mb-2">Vendors</h4>
                    <p className="text-sm text-gray-600">
                      Product creators who upload and sell digital products through our marketplace. Vendors set their
                      own prices, commission rates, and manage their affiliate programs.
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                      <Users className="w-6 h-6 text-purple-600" />
                    </div>
                    <h4 className="font-bold text-gray-900 mb-2">Affiliates</h4>
                    <p className="text-sm text-gray-600">
                      Marketers who promote products and earn commissions on every sale they generate. Affiliates have
                      access to thousands of products across multiple categories.
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg transition-shadow">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                      <ShoppingCart className="w-6 h-6 text-green-600" />
                    </div>
                    <h4 className="font-bold text-gray-900 mb-2">Customers</h4>
                    <p className="text-sm text-gray-600">
                      End users who purchase products through the marketplace. They benefit from quality products,
                      secure payments, and instant digital delivery.
                    </p>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Why Choose Affilova?</h3>

                <p className="mb-6">
                  In a market filled with affiliate platforms, Affilova stands out through our commitment to excellence,
                  transparency, and user success. Here's what makes us different:
                </p>

                <div className="space-y-4 my-8">
                  {[
                    {
                      icon: Shield,
                      title: "Nigerian-Focused Platform",
                      description:
                        "Built specifically for the Nigerian market with Naira payments, local bank transfers, and understanding of local business practices.",
                    },
                    {
                      icon: Zap,
                      title: "Instant Product Delivery",
                      description:
                        "Automatic delivery of digital products immediately after purchase. No delays, no manual intervention required.",
                    },
                    {
                      icon: CreditCard,
                      title: "Secure Payment Processing",
                      description:
                        "Powered by Squad for reliable, secure transactions with multiple payment options including cards, bank transfers, and USSD.",
                    },
                    {
                      icon: Clock,
                      title: "Weekly Payouts",
                      description:
                        "Get paid every Thursday without fail. No minimum threshold hassles—if you've earned, you get paid.",
                    },
                    {
                      icon: BarChart3,
                      title: "Real-Time Analytics",
                      description:
                        "Track every click, view, and conversion in real-time. Make data-driven decisions to optimize your performance.",
                    },
                    {
                      icon: Headphones,
                      title: "Dedicated Support",
                      description:
                        "Our support team is available to help you succeed. From technical issues to business advice, we're here for you.",
                    },
                  ].map((item, index) => (
                    <div key={index} className="flex gap-4 p-4 bg-gray-50 rounded-xl">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <item.icon className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
                        <p className="text-sm text-gray-600">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-green-600 text-white rounded-2xl p-8 my-8">
                  <h4 className="text-xl font-bold mb-4">Platform Statistics</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                      <div className="text-3xl font-bold">10,000+</div>
                      <div className="text-green-200 text-sm">Active Users</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold">₦500M+</div>
                      <div className="text-green-200 text-sm">Revenue Processed</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold">500+</div>
                      <div className="text-green-200 text-sm">Products Listed</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold">98%</div>
                      <div className="text-green-200 text-sm">Payout Success Rate</div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Our Mission</h3>

                <p className="mb-6">
                  At Affilova, our mission is to democratize digital commerce in Nigeria and across Africa. We believe
                  that everyone with a valuable product or the willingness to promote quality products should have
                  access to a platform that enables their success.
                </p>

                <p className="mb-6">
                  We're not just building a marketplace—we're creating an ecosystem where knowledge is shared,
                  opportunities are equal, and success is achievable for all who put in the effort. Whether you're in
                  Lagos, Abuja, Port Harcourt, or any corner of Nigeria, Affilova gives you the tools to build a
                  thriving online business.
                </p>

                <blockquote className="border-l-4 border-green-500 pl-6 py-4 my-8 bg-green-50 rounded-r-xl">
                  <p className="text-lg italic text-gray-700 mb-2">
                    "Our vision is to become the leading affiliate marketing platform in Africa, empowering millions of
                    entrepreneurs to achieve financial freedom through digital products."
                  </p>
                  <cite className="text-sm text-gray-500">— Affilova Founding Team</cite>
                </blockquote>
              </div>
            </section>

            {/* Section 2: Getting Started */}
            <section id="getting-started" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Rocket className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Getting Started</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Getting started with Affilova is straightforward and takes only a few minutes. This section will walk
                  you through the entire process from creating your account to making your first sale or earning your
                  first commission.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Step 1: Create Your Account</h3>

                <p className="mb-6">
                  The first step to joining Affilova is creating your account. We've designed our registration process
                  to be quick and simple while ensuring the security of your information.
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-green-600" />
                    Registration Options
                  </h4>

                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border-2 border-green-500 text-green-600 font-bold flex-shrink-0">
                        1
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900">Email Registration</h5>
                        <p className="text-sm text-gray-600">
                          Sign up using your email address and create a secure password. You'll receive a verification
                          email to confirm your account.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center border-2 border-green-500 text-green-600 font-bold flex-shrink-0">
                        2
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900">Google Sign-In</h5>
                        <p className="text-sm text-gray-600">
                          For faster registration, use your Google account. This automatically verifies your email and
                          pre-fills your basic information.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-yellow-800 mb-2">Important Note</h4>
                      <p className="text-yellow-700 text-sm">
                        Make sure to use a valid email address as this will be your primary communication channel with
                        Affilova. All important notifications, payout confirmations, and platform updates will be sent
                        to this email.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Step 2: Choose Your Role</h3>

                <p className="mb-6">
                  After creating your account, you'll need to choose your primary role on Affilova. This determines your
                  dashboard experience and the features available to you.
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border-2 border-blue-200 rounded-xl p-6">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                      <Store className="w-6 h-6 text-blue-600" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3">Become a Vendor</h4>
                    <p className="text-gray-600 mb-4">
                      Choose this if you have digital products to sell. As a vendor, you can:
                    </p>
                    <ul className="space-y-2">
                      {[
                        "Upload unlimited digital products",
                        "Create custom sales pages",
                        "Set your own prices and commissions",
                        "Recruit and manage affiliates",
                        "Track sales and revenue",
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-white border-2 border-purple-200 rounded-xl p-6">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                      <TrendingUp className="w-6 h-6 text-purple-600" />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3">Become an Affiliate</h4>
                    <p className="text-gray-600 mb-4">
                      Choose this if you want to promote products and earn commissions. As an affiliate, you can:
                    </p>
                    <ul className="space-y-2">
                      {[
                        "Browse 500+ products to promote",
                        "Generate unique affiliate links",
                        "Earn up to 50% commission per sale",
                        "Access marketing materials",
                        "Track your performance metrics",
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-green-800 mb-2">Pro Tip</h4>
                      <p className="text-green-700 text-sm">
                        Many successful users on Affilova are both vendors AND affiliates. You can promote your own
                        products while also earning commissions from other vendors' products. This hybrid approach
                        maximizes your earning potential.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Step 3: Complete Your Profile</h3>

                <p className="mb-6">
                  A complete profile helps build trust with potential customers and partners. Here's what you need to
                  fill out during onboarding:
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Profile Information Required</h4>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <h5 className="font-semibold text-gray-700">For Vendors:</h5>
                      <ul className="space-y-2 text-sm text-gray-600">
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Business/Brand Name
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Business Description
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Product Categories
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Contact Information
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Profile Picture/Logo
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          Social Media Links
                        </li>
                      </ul>
                    </div>

                    <div className="space-y-3">
                      <h5 className="font-semibold text-gray-700">For Affiliates:</h5>
                      <ul className="space-y-2 text-sm text-gray-600">
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Display Name
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Experience Level
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Marketing Channels
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Niche/Categories of Interest
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Profile Picture
                        </li>
                        <li className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full" />
                          Website/Social Links
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Step 4: Set Up Payment Information</h3>

                <p className="mb-6">
                  To receive payments, you'll need to add your bank account details. This can be done after onboarding
                  from your dashboard's Payment Information section.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-green-600" />
                    Payment Setup Requirements
                  </h4>

                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Building className="w-5 h-5 text-gray-600 mt-0.5" />
                      <div>
                        <h5 className="font-semibold text-gray-900">Bank Name</h5>
                        <p className="text-sm text-gray-600">
                          Select your bank from our list of supported Nigerian banks
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <CreditCard className="w-5 h-5 text-gray-600 mt-0.5" />
                      <div>
                        <h5 className="font-semibold text-gray-900">Account Number</h5>
                        <p className="text-sm text-gray-600">Your 10-digit NUBAN account number</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <UserCheck className="w-5 h-5 text-gray-600 mt-0.5" />
                      <div>
                        <h5 className="font-semibold text-gray-900">Account Name</h5>
                        <p className="text-sm text-gray-600">Automatically verified to match your account</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Shield className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-blue-800 mb-2">Security Assurance</h4>
                      <p className="text-blue-700 text-sm">
                        Your bank details are encrypted using industry-standard 256-bit encryption. We never store your
                        full account details in plain text, and all payment processing is handled by our PCI-DSS
                        compliant payment partner, Squad.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Step 5: Explore Your Dashboard</h3>

                <p className="mb-6">
                  Once your profile is complete, you'll be taken to your personalized dashboard. This is your command
                  center for all activities on Affilova.
                </p>

                <div className="relative my-8">
                  <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 text-white">
                    <h4 className="text-xl font-bold mb-6">Dashboard Overview</h4>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <LayoutDashboard className="w-5 h-5" />
                          <span>Overview - Quick stats and metrics</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <Package className="w-5 h-5" />
                          <span>Products - Manage your listings</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <Users className="w-5 h-5" />
                          <span>Affiliates - Your affiliate network</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <BarChart3 className="w-5 h-5" />
                          <span>Analytics - Detailed reports</span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <Wallet className="w-5 h-5" />
                          <span>Earnings - Revenue tracking</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <Receipt className="w-5 h-5" />
                          <span>Transactions - Payment history</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <Settings className="w-5 h-5" />
                          <span>Settings - Account configuration</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-white/10 rounded-lg">
                          <HelpCircle className="w-5 h-5" />
                          <span>Support - Help and resources</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="mb-6">
                  Now that you understand the basics of getting started, let's dive deeper into the specific features
                  and processes for vendors and affiliates in the following sections.
                </p>
              </div>
            </section>

            {/* Section 3: Account Setup Guide */}
            <section id="account-setup" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Settings className="w-6 h-6 text-purple-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Account Setup Guide</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Properly setting up your Affilova account is crucial for your success on the platform. This
                  comprehensive guide covers every aspect of account configuration, from security settings to
                  notification preferences.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Security Settings</h3>

                <p className="mb-6">
                  Security should be your top priority when managing any online business account. Affilova provides
                  multiple layers of security to protect your account and earnings.
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Lock className="w-5 h-5 text-green-600" />
                    Password Requirements
                  </h4>

                  <p className="text-gray-600 mb-4">
                    Your password is the first line of defense. We require strong passwords that meet the following
                    criteria:
                  </p>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>Minimum 8 characters</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>At least one uppercase letter</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>At least one lowercase letter</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>At least one number</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>At least one special character</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>No common patterns or words</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-purple-600" />
                    Two-Factor Authentication (2FA)
                  </h4>

                  <p className="text-gray-600 mb-4">
                    For additional security, we strongly recommend enabling two-factor authentication. With 2FA enabled,
                    you'll need both your password and a verification code to access your account.
                  </p>

                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Smartphone className="w-5 h-5 text-gray-600 mt-0.5" />
                      <div>
                        <h5 className="font-semibold text-gray-900">Authenticator App</h5>
                        <p className="text-sm text-gray-600">
                          Use apps like Google Authenticator or Authy to generate time-based codes
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      <Mail className="w-5 h-5 text-gray-600 mt-0.5" />
                      <div>
                        <h5 className="font-semibold text-gray-900">Email Verification</h5>
                        <p className="text-sm text-gray-600">
                          Receive verification codes via email for sensitive operations
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Profile Optimization</h3>

                <p className="mb-6">
                  Your profile is your digital storefront on Affilova. A well-optimized profile builds trust and
                  increases your chances of success, whether you're a vendor attracting affiliates or an affiliate
                  gaining access to exclusive products.
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                    <h4 className="font-bold text-green-800 mb-4">Do's</h4>
                    <ul className="space-y-2">
                      {[
                        "Use a professional profile photo",
                        "Write a compelling bio",
                        "List all relevant experience",
                        "Include your website/social links",
                        "Keep information up to date",
                        "Verify your email address",
                        "Complete all profile sections",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-green-700">
                          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <h4 className="font-bold text-red-800 mb-4">Don'ts</h4>
                    <ul className="space-y-2">
                      {[
                        "Use fake or stock photos",
                        "Leave sections incomplete",
                        "Use misleading information",
                        "Ignore profile requests",
                        "Share sensitive personal data",
                        "Use unprofessional language",
                        "Copy other users' profiles",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                          <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Notification Preferences</h3>

                <p className="mb-6">
                  Stay informed about important activities without being overwhelmed. Customize your notification
                  settings to receive updates that matter most to you.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                    <h4 className="font-bold text-gray-900">Available Notification Types</h4>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {[
                      {
                        icon: ShoppingCart,
                        title: "Sales Notifications",
                        desc: "Get notified when you make a sale or earn a commission",
                      },
                      {
                        icon: Users,
                        title: "Affiliate Activity",
                        desc: "Updates when affiliates join your program or make sales",
                      },
                      {
                        icon: Wallet,
                        title: "Payout Alerts",
                        desc: "Notifications about pending and completed payouts",
                      },
                      { icon: Package, title: "Product Updates", desc: "Changes to products you're promoting" },
                      { icon: Bell, title: "Platform Announcements", desc: "Important news and feature updates" },
                      { icon: MessageSquare, title: "Messages", desc: "Direct messages from vendors or affiliates" },
                      {
                        icon: TrendingUp,
                        title: "Performance Reports",
                        desc: "Weekly and monthly performance summaries",
                      },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-6 py-4">
                        <div className="flex items-center gap-3">
                          <item.icon className="w-5 h-5 text-gray-400" />
                          <div>
                            <h5 className="font-medium text-gray-900">{item.title}</h5>
                            <p className="text-sm text-gray-500">{item.desc}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-green-600">Email</span>
                          <span className="text-purple-600">Push</span>
                          <span className="text-blue-600">SMS</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Account Verification Levels</h3>

                <p className="mb-6">
                  Affilova uses a tiered verification system to ensure platform security while rewarding users who
                  complete additional verification steps.
                </p>

                <div className="space-y-4 my-8">
                  <div className="bg-gray-50 rounded-xl p-6 border-l-4 border-gray-400">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <UserCheck className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">Basic Verification</h4>
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Default</span>
                      </div>
                    </div>
                    <ul className="space-y-1 text-sm text-gray-600 ml-13">
                      <li>• Email verification complete</li>
                      <li>• Basic profile information</li>
                      <li>• Standard withdrawal limits</li>
                    </ul>
                  </div>

                  <div className="bg-blue-50 rounded-xl p-6 border-l-4 border-blue-500">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-blue-200 rounded-full flex items-center justify-center">
                        <BadgeCheck className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">Verified Account</h4>
                        <span className="text-xs bg-blue-200 text-blue-600 px-2 py-0.5 rounded">Recommended</span>
                      </div>
                    </div>
                    <ul className="space-y-1 text-sm text-gray-600 ml-13">
                      <li>• Phone number verified</li>
                      <li>• Bank account validated</li>
                      <li>• Higher withdrawal limits</li>
                      <li>• Priority support access</li>
                    </ul>
                  </div>

                  <div className="bg-green-50 rounded-xl p-6 border-l-4 border-green-500">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-green-200 rounded-full flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">Pro Verification</h4>
                        <span className="text-xs bg-green-200 text-green-600 px-2 py-0.5 rounded">Premium</span>
                      </div>
                    </div>
                    <ul className="space-y-1 text-sm text-gray-600 ml-13">
                      <li>• Identity document verified</li>
                      <li>• Business registration (for vendors)</li>
                      <li>• Unlimited withdrawals</li>
                      <li>• Featured placement in marketplace</li>
                      <li>• Dedicated account manager</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 4: Complete Vendor Guide */}
            <section id="vendor-guide" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Complete Vendor Guide</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  As a vendor on Affilova, you have access to a powerful suite of tools designed to help you sell your
                  digital products, manage affiliates, and grow your business. This comprehensive guide covers
                  everything from product creation to advanced selling strategies.
                </p>

                <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 my-8 text-white">
                  <h3 className="text-2xl font-bold mb-4">Vendor Success Path</h3>
                  <div className="grid md:grid-cols-5 gap-4">
                    {[
                      { step: 1, title: "Create Product", icon: Package },
                      { step: 2, title: "Build Sales Page", icon: FileText },
                      { step: 3, title: "Set Pricing", icon: DollarSign },
                      { step: 4, title: "Recruit Affiliates", icon: Users },
                      { step: 5, title: "Scale & Optimize", icon: TrendingUp },
                    ].map((item) => (
                      <div key={item.step} className="text-center">
                        <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
                          <item.icon className="w-6 h-6" />
                        </div>
                        <div className="text-xs text-blue-200 mb-1">Step {item.step}</div>
                        <div className="text-sm font-medium">{item.title}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Understanding the Vendor Dashboard</h3>

                <p className="mb-6">
                  Your vendor dashboard is the central hub for managing all aspects of your digital product business.
                  Let's explore each section in detail:
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Dashboard Sections Overview</h4>

                  <div className="space-y-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <LayoutDashboard className="w-5 h-5 text-blue-600" />
                        <h5 className="font-semibold text-gray-900">Overview</h5>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Your main dashboard showing key metrics at a glance including total revenue, active products,
                        affiliate performance, and recent sales.
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">₦1.2M</div>
                          <div className="text-xs text-gray-500">Revenue</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">12</div>
                          <div className="text-xs text-gray-500">Products</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">45</div>
                          <div className="text-xs text-gray-500">Affiliates</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">234</div>
                          <div className="text-xs text-gray-500">Sales</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <Package className="w-5 h-5 text-green-600" />
                        <h5 className="font-semibold text-gray-900">Products</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        Manage all your digital products. Add new products, edit existing ones, view performance
                        metrics, and control product visibility and pricing.
                      </p>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <Users className="w-5 h-5 text-purple-600" />
                        <h5 className="font-semibold text-gray-900">Affiliates</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        View and manage your affiliate network. See who's promoting your products, track their
                        performance, approve affiliate requests, and communicate with top performers.
                      </p>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <BarChart3 className="w-5 h-5 text-orange-600" />
                        <h5 className="font-semibold text-gray-900">Analytics</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        Deep dive into your business metrics. View sales trends, conversion rates, traffic sources, and
                        detailed reports to optimize your strategy.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Creating Your First Product</h3>

                <p className="mb-6">
                  Creating a product on Affilova is a straightforward process, but taking the time to do it right can
                  significantly impact your sales. Here's a detailed walkthrough:
                </p>

                <div className="space-y-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                        1
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Product Information</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Start by entering the basic details about your product. This information helps buyers understand
                      what they're purchasing and helps affiliates promote it effectively.
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Product Title</label>
                          <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500">
                            e.g., "Complete Digital Marketing Course"
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                          <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500">
                            e.g., "Education & Training"
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                          <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 h-20">
                            Detailed description of your product (minimum 100 characters recommended)
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                        2
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Product Files</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Upload your digital product files. We support a wide range of file formats to accommodate various
                      types of digital products.
                    </p>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <FileText className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Documents</div>
                        <div className="text-xs text-gray-500">PDF, DOC, DOCX, TXT</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <Video className="w-8 h-8 text-red-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Videos</div>
                        <div className="text-xs text-gray-500">MP4, MOV, AVI, MKV</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <Headphones className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Audio</div>
                        <div className="text-xs text-gray-500">MP3, WAV, AAC</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <ImageIcon className="w-8 h-8 text-green-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Images</div>
                        <div className="text-xs text-gray-500">JPG, PNG, GIF, SVG</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <Archive className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Archives</div>
                        <div className="text-xs text-gray-500">ZIP, RAR, 7Z</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <Code className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                        <div className="font-medium text-gray-900">Software</div>
                        <div className="text-xs text-gray-500">Any executable format</div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                        3
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Pricing & Commission</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Set your product price and determine how much commission affiliates will earn for each sale they
                      generate.
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="grid md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Product Price</label>
                          <div className="flex items-center bg-white border border-gray-300 rounded-lg">
                            <span className="px-3 py-2 bg-gray-100 border-r text-gray-500">₦</span>
                            <span className="px-3 py-2 text-gray-500">e.g., 15,000</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Commission Rate</label>
                          <div className="flex items-center bg-white border border-gray-300 rounded-lg">
                            <span className="px-3 py-2 text-gray-500">e.g., 30</span>
                            <span className="px-3 py-2 bg-gray-100 border-l text-gray-500">%</span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Affiliate Earnings</label>
                          <div className="bg-green-100 border border-green-300 rounded-lg px-3 py-2 text-green-700 font-medium">
                            ₦4,500 per sale
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                        4
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Product Images</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Upload compelling product images that showcase your product. High-quality visuals significantly
                      improve conversion rates.
                    </p>
                    <div className="flex items-center gap-4">
                      <div className="w-32 h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                        <div className="text-center">
                          <ImageIcon className="w-8 h-8 text-gray-400 mx-auto mb-1" />
                          <span className="text-xs text-gray-500">Main Image</span>
                        </div>
                      </div>
                      <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                        <Plus className="w-6 h-6 text-gray-400" />
                      </div>
                      <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                        <Plus className="w-6 h-6 text-gray-400" />
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-4">
                      Recommended: 1200x630px for main image, JPG or PNG format
                    </p>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-yellow-800 mb-2">Pro Tips for Product Success</h4>
                      <ul className="space-y-2 text-sm text-yellow-700">
                        <li>• Write detailed, benefit-focused product descriptions</li>
                        <li>• Use high-quality images that showcase your product</li>
                        <li>• Set competitive commission rates to attract top affiliates (30-50% recommended)</li>
                        <li>• Include bonus materials to increase perceived value</li>
                        <li>• Create a compelling product name that includes keywords</li>
                        <li>• Provide marketing materials for your affiliates</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Managing Your Affiliate Program</h3>

                <p className="mb-6">
                  Your affiliates are the engine of your sales machine. Learning to recruit, manage, and motivate them
                  effectively is crucial for scaling your business.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                    <h4 className="font-bold text-gray-900">Affiliate Management Features</h4>
                  </div>
                  <div className="p-6 space-y-6">
                    <div>
                      <h5 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-green-600" />
                        Recruiting Affiliates
                      </h5>
                      <p className="text-gray-600 text-sm mb-3">
                        There are multiple ways to grow your affiliate network on Affilova:
                      </p>
                      <ul className="space-y-2 text-sm text-gray-600">
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>Marketplace Listing:</strong> Your products appear in our marketplace where
                            affiliates can discover and apply to promote them
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>Direct Invitations:</strong> Send personalized invitation links to influencers and
                            marketers
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>Referral Programs:</strong> Incentivize existing affiliates to recruit new ones
                          </span>
                        </li>
                      </ul>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                      <h5 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-blue-600" />
                        Approval Settings
                      </h5>
                      <p className="text-gray-600 text-sm mb-3">
                        Control who can promote your products with flexible approval settings:
                      </p>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h6 className="font-medium text-gray-900 mb-1">Auto-Approve</h6>
                          <p className="text-xs text-gray-500">
                            Any affiliate can immediately start promoting your products
                          </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h6 className="font-medium text-gray-900 mb-1">Manual Approval</h6>
                          <p className="text-xs text-gray-500">
                            Review and approve each affiliate request individually
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                      <h5 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Award className="w-5 h-5 text-purple-600" />
                        Affiliate Tiers & Bonuses
                      </h5>
                      <p className="text-gray-600 text-sm mb-3">
                        Motivate top performers with tiered commission structures and bonuses:
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50">
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Tier</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Sales Required</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Commission Bonus</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Perks</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            <tr>
                              <td className="px-4 py-2">Bronze</td>
                              <td className="px-4 py-2">0-10 sales</td>
                              <td className="px-4 py-2">Base rate</td>
                              <td className="px-4 py-2">Standard support</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2">Silver</td>
                              <td className="px-4 py-2">11-50 sales</td>
                              <td className="px-4 py-2">+5%</td>
                              <td className="px-4 py-2">Priority support</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2">Gold</td>
                              <td className="px-4 py-2">51-100 sales</td>
                              <td className="px-4 py-2">+10%</td>
                              <td className="px-4 py-2">Exclusive materials</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-2">Platinum</td>
                              <td className="px-4 py-2">100+ sales</td>
                              <td className="px-4 py-2">+15%</td>
                              <td className="px-4 py-2">Direct line + bonuses</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Revenue & Pricing Strategies</h3>

                <p className="mb-6">
                  Pricing your digital products correctly is both an art and a science. Here are proven strategies to
                  maximize your revenue:
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5 text-red-600" />
                      Value-Based Pricing
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Price based on the value your product provides, not just the cost to create it. Consider:
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• How much money/time will customers save?</li>
                      <li>• What results can customers expect?</li>
                      <li>• What are competitors charging?</li>
                      <li>• What is your target market willing to pay?</li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Layers className="w-5 h-5 text-blue-600" />
                      Tiered Pricing
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Offer multiple versions of your product at different price points:
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>
                        • <strong>Basic:</strong> Core product only
                      </li>
                      <li>
                        • <strong>Standard:</strong> Product + bonus materials
                      </li>
                      <li>
                        • <strong>Premium:</strong> Everything + personal support
                      </li>
                      <li>
                        • <strong>VIP:</strong> All access + coaching calls
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Percent className="w-5 h-5 text-green-600" />
                      Launch Pricing
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Create urgency and build momentum with strategic launch pricing:
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Early bird discounts (20-40% off)</li>
                      <li>• Limited time bonuses</li>
                      <li>• Founder's pricing for first 100 customers</li>
                      <li>• Bundle deals with other products</li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-purple-600" />
                      Recurring Revenue
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Build predictable income with subscription-based products:
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Membership sites with monthly content</li>
                      <li>• Software as a Service (SaaS)</li>
                      <li>• Ongoing coaching programs</li>
                      <li>• Community access subscriptions</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 5: Complete Affiliate Guide */}
            <section id="affiliate-guide" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Complete Affiliate Guide</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  As an affiliate on Affilova, you have the opportunity to earn significant income by promoting quality
                  digital products to your audience. This comprehensive guide will teach you everything from finding the
                  right products to advanced promotion strategies.
                </p>

                <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-8 my-8 text-white">
                  <h3 className="text-2xl font-bold mb-4">Affiliate Success Path</h3>
                  <div className="grid md:grid-cols-5 gap-4">
                    {[
                      { step: 1, title: "Find Products", icon: Search },
                      { step: 2, title: "Get Links", icon: Link2 },
                      { step: 3, title: "Create Content", icon: FileText },
                      { step: 4, title: "Promote", icon: Megaphone },
                      { step: 5, title: "Earn & Scale", icon: DollarSign },
                    ].map((item) => (
                      <div key={item.step} className="text-center">
                        <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
                          <item.icon className="w-6 h-6" />
                        </div>
                        <div className="text-xs text-purple-200 mb-1">Step {item.step}</div>
                        <div className="text-sm font-medium">{item.title}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Understanding Your Affiliate Dashboard</h3>

                <p className="mb-6">
                  Your affiliate dashboard provides all the tools you need to find products, track performance, and
                  manage your earnings. Here's a detailed overview:
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Dashboard Sections Overview</h4>

                  <div className="space-y-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <LayoutDashboard className="w-5 h-5 text-purple-600" />
                        <h5 className="font-semibold text-gray-900">Overview</h5>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        Your main dashboard showing earnings at a glance, click statistics, conversion rates, and recent
                        commission activities.
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">₦450K</div>
                          <div className="text-xs text-gray-500">Earnings</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">12,456</div>
                          <div className="text-xs text-gray-500">Clicks</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">3.2%</div>
                          <div className="text-xs text-gray-500">Conv. Rate</div>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <div className="text-lg font-bold text-gray-900">89</div>
                          <div className="text-xs text-gray-500">Sales</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <Search className="w-5 h-5 text-blue-600" />
                        <h5 className="font-semibold text-gray-900">Marketplace</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        Browse hundreds of products across multiple categories. Filter by niche, commission rate, price
                        point, and popularity to find the perfect products to promote.
                      </p>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <Link2 className="w-5 h-5 text-green-600" />
                        <h5 className="font-semibold text-gray-900">My Links</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        Manage all your affiliate links in one place. Create custom tracking links, view click
                        statistics, and organize links by campaign or platform.
                      </p>
                    </div>

                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-3 mb-2">
                        <Wallet className="w-5 h-5 text-orange-600" />
                        <h5 className="font-semibold text-gray-900">Earnings</h5>
                      </div>
                      <p className="text-sm text-gray-600">
                        Track your earnings in detail. View pending commissions, completed payouts, and historical data
                        to understand your income patterns.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Finding the Right Products to Promote</h3>

                <p className="mb-6">
                  Success in affiliate marketing starts with choosing the right products. Here's how to find products
                  that will resonate with your audience and generate consistent sales:
                </p>

                <div className="space-y-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold">
                        1
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Know Your Audience</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Before browsing products, understand your audience's needs, pain points, and purchasing power:
                    </p>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h5 className="font-medium text-gray-900 mb-2">Questions to Ask:</h5>
                        <ul className="space-y-1 text-sm text-gray-600">
                          <li>• What problems do they face?</li>
                          <li>• What are their goals?</li>
                          <li>• How much can they afford?</li>
                          <li>• Where do they spend time online?</li>
                        </ul>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <h5 className="font-medium text-gray-900 mb-2">Research Methods:</h5>
                        <ul className="space-y-1 text-sm text-gray-600">
                          <li>• Survey your existing audience</li>
                          <li>• Analyze engagement on your content</li>
                          <li>• Study competitors' offerings</li>
                          <li>• Join relevant online communities</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold">
                        2
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Use Marketplace Filters</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Affilova's marketplace offers powerful filtering options to help you find the perfect products:
                    </p>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <Filter className="w-6 h-6 text-blue-600 mb-2" />
                        <h5 className="font-medium text-gray-900 mb-1">By Category</h5>
                        <p className="text-xs text-gray-500">Education, Software, Health, Finance, etc.</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <Percent className="w-6 h-6 text-green-600 mb-2" />
                        <h5 className="font-medium text-gray-900 mb-1">By Commission</h5>
                        <p className="text-xs text-gray-500">Filter by commission rate (10-50%+)</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <TrendingUp className="w-6 h-6 text-purple-600 mb-2" />
                        <h5 className="font-medium text-gray-900 mb-1">By Performance</h5>
                        <p className="text-xs text-gray-500">Sort by conversion rate and popularity</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 font-bold">
                        3
                      </div>
                      <h4 className="text-xl font-bold text-gray-900">Evaluate Product Quality</h4>
                    </div>
                    <p className="text-gray-600 mb-4">
                      Before promoting any product, ensure it meets quality standards. Your reputation is on the line:
                    </p>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                      <h5 className="font-medium text-green-800 mb-2">Green Flags:</h5>
                      <ul className="space-y-1 text-sm text-green-700">
                        <li className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Detailed product description and preview
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Professional sales page design
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Good reviews and testimonials
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Responsive vendor with good support
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Low refund rate
                        </li>
                      </ul>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <h5 className="font-medium text-red-800 mb-2">Red Flags:</h5>
                      <ul className="space-y-1 text-sm text-red-700">
                        <li className="flex items-center gap-2">
                          <X className="w-4 h-4" />
                          Vague or misleading descriptions
                        </li>
                        <li className="flex items-center gap-2">
                          <X className="w-4 h-4" />
                          Unrealistic income claims
                        </li>
                        <li className="flex items-center gap-2">
                          <X className="w-4 h-4" />
                          High refund rates
                        </li>
                        <li className="flex items-center gap-2">
                          <X className="w-4 h-4" />
                          Unresponsive vendor
                        </li>
                        <li className="flex items-center gap-2">
                          <X className="w-4 h-4" />
                          No proof of results
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Creating Effective Affiliate Links</h3>

                <p className="mb-6">
                  Your affiliate link is the bridge between your promotional efforts and your commissions. Understanding
                  how to create and use them effectively is crucial:
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Anatomy of an Affiliate Link</h4>

                  <div className="bg-white rounded-lg p-4 border border-gray-200 mb-4">
                    <code className="text-sm text-gray-600 break-all">
                      https://affilova.com/product/digital-marketing-course?
                      <span className="text-green-600">ref=yourname</span>&
                      <span className="text-blue-600">utm_source=instagram</span>&
                      <span className="text-purple-600">utm_campaign=launch</span>
                    </code>
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 bg-green-500 rounded-full" />
                        <span className="font-medium text-gray-900">Referral ID</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Your unique identifier that ensures you get credit for all sales
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full" />
                        <span className="font-medium text-gray-900">Source Tracking</span>
                      </div>
                      <p className="text-sm text-gray-600">Track which platform your traffic comes from</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 bg-purple-500 rounded-full" />
                        <span className="font-medium text-gray-900">Campaign Tracking</span>
                      </div>
                      <p className="text-sm text-gray-600">Identify which specific campaign generated the sale</p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Promotion Channels & Strategies</h3>

                <p className="mb-6">
                  Successful affiliates diversify their promotion channels. Here are the most effective channels and how
                  to leverage them:
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center">
                        <Instagram className="w-5 h-5 text-pink-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">Instagram</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Perfect for visual products and lifestyle niches. Use Stories, Reels, and bio links.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Share authentic product experiences
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Use link-in-bio tools for multiple products
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Create engaging Reels demonstrating value
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                        <Youtube className="w-5 h-5 text-red-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">YouTube</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Ideal for detailed reviews, tutorials, and educational content.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Create in-depth product review videos
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Include links in description and pinned comments
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Use end screens and cards for CTAs
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Twitter className="w-5 h-5 text-blue-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">Twitter/X</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Great for building authority and engaging in conversations around your niche.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Share valuable tips and insights
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Create threads about product benefits
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Engage with potential customers authentically
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                        <Mail className="w-5 h-5 text-orange-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">Email Marketing</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      The highest-converting channel. Build and nurture your email list.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Build trust before promoting
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Segment your list by interests
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Provide value in every email
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <Globe className="w-5 h-5 text-green-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">Blog/Website</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Long-term SEO strategy for passive traffic and commissions.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Write detailed product reviews
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Create comparison articles
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Optimize for buyer-intent keywords
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-green-600" />
                      </div>
                      <h4 className="font-bold text-gray-900">WhatsApp</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Direct, personal communication channel popular in Nigeria.
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Use Status updates for promotions
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Create broadcast lists for updates
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        Personalize your recommendations
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Star className="w-6 h-6 text-purple-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-purple-800 mb-2">Content Ideas That Convert</h4>
                      <div className="grid md:grid-cols-2 gap-4 mt-4">
                        <ul className="space-y-2 text-sm text-purple-700">
                          <li>• Product review and walkthrough</li>
                          <li>• "How I use [product] to achieve [result]"</li>
                          <li>• Comparison: [Product A] vs [Product B]</li>
                          <li>• Top 10 tools for [your niche]</li>
                          <li>• Case study with real results</li>
                        </ul>
                        <ul className="space-y-2 text-sm text-purple-700">
                          <li>• Behind-the-scenes of using the product</li>
                          <li>• Q&A about the product</li>
                          <li>• Bonus guide for product buyers</li>
                          <li>• Limited-time discount announcements</li>
                          <li>• Success story transformations</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 6: Product Management */}
            <section id="product-management" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                  <Package className="w-6 h-6 text-orange-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Product Management</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Effective product management is the cornerstone of a successful digital product business. This section
                  covers everything from organizing your product catalog to optimizing for maximum conversions.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Product Categories & Organization</h3>

                <p className="mb-6">
                  Affilova supports a wide range of digital product categories. Understanding how to categorize your
                  products properly ensures they reach the right audience:
                </p>

                <div className="grid md:grid-cols-3 gap-4 my-8">
                  {[
                    { icon: BookOpen, name: "Education & Courses", desc: "Online courses, tutorials, guides" },
                    { icon: Code, name: "Software & Tools", desc: "Apps, plugins, templates, scripts" },
                    { icon: FileText, name: "eBooks & Documents", desc: "Books, reports, checklists" },
                    { icon: Video, name: "Video Content", desc: "Training videos, webinars" },
                    { icon: Headphones, name: "Audio Products", desc: "Podcasts, audiobooks, music" },
                    { icon: ImageIcon, name: "Graphics & Design", desc: "Templates, mockups, assets" },
                    { icon: Briefcase, name: "Business Resources", desc: "Business plans, strategies" },
                    { icon: Heart, name: "Health & Wellness", desc: "Fitness, nutrition, mindfulness" },
                    { icon: DollarSign, name: "Finance & Investing", desc: "Trading, budgeting, crypto" },
                  ].map((category, i) => (
                    <div
                      key={i}
                      className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                    >
                      <category.icon className="w-8 h-8 text-green-600 mb-3" />
                      <h4 className="font-semibold text-gray-900 mb-1">{category.name}</h4>
                      <p className="text-sm text-gray-500">{category.desc}</p>
                    </div>
                  ))}
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Product Optimization Checklist</h3>

                <p className="mb-6">
                  Before publishing your product, ensure it meets all optimization criteria for maximum visibility and
                  conversions:
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                    <h4 className="font-bold text-gray-900">Pre-Launch Checklist</h4>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      {[
                        {
                          category: "Product Information",
                          items: [
                            "Compelling title with keywords",
                            "Detailed description (500+ words)",
                            "Clear benefit statements",
                            "Accurate category selection",
                          ],
                        },
                        {
                          category: "Visual Assets",
                          items: [
                            "High-quality cover image (1200x630)",
                            "Additional product screenshots",
                            "Video preview (if applicable)",
                            "Consistent branding",
                          ],
                        },
                        {
                          category: "Pricing",
                          items: [
                            "Competitive price research",
                            "Commission rate set (30%+ recommended)",
                            "Discount codes configured",
                            "Bundle options considered",
                          ],
                        },
                        {
                          category: "Product Files",
                          items: [
                            "Files tested and working",
                            "Proper file naming",
                            "Readme/instructions included",
                            "Mobile-friendly formats",
                          ],
                        },
                      ].map((section, i) => (
                        <div key={i} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                          <h5 className="font-semibold text-gray-900 mb-3">{section.category}</h5>
                          <div className="grid md:grid-cols-2 gap-2">
                            {section.items.map((item, j) => (
                              <label key={j} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                                <div className="w-5 h-5 border-2 border-gray-300 rounded flex items-center justify-center">
                                  <CheckCircle className="w-3 h-3 text-green-500" />
                                </div>
                                {item}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Product Lifecycle Management</h3>

                <p className="mb-6">
                  Digital products require ongoing management to maintain relevance and maximize long-term revenue:
                </p>

                <div className="space-y-4 my-8">
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Upload className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Launch Phase</h4>
                      <p className="text-sm text-gray-600">
                        Focus on initial promotion, gathering reviews, and building momentum. Offer launch discounts and
                        recruit your first affiliates.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Growth Phase</h4>
                      <p className="text-sm text-gray-600">
                        Scale your affiliate network, optimize conversions based on data, and consider creating upsells
                        or complementary products.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <RefreshCw className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Maintenance Phase</h4>
                      <p className="text-sm text-gray-600">
                        Regular updates to keep content current, respond to customer feedback, and maintain affiliate
                        relationships.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Revival Phase</h4>
                      <p className="text-sm text-gray-600">
                        Re-launch with major updates, bundle with new products, or create version 2.0 to reinvigorate
                        sales.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 7: Creating Sales Pages */}
            <section id="sales-pages" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-pink-100 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-pink-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Creating Sales Pages</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Your sales page is where the magic happens—it's the final touchpoint that convinces visitors to become
                  customers. Affilova's drag and drop page builder makes it easy to create high-converting sales pages
                  without any coding knowledge.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Anatomy of a High-Converting Sales Page</h3>

                <p className="mb-6">
                  The most successful sales pages follow a proven structure that guides visitors from curiosity to
                  purchase:
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <div className="relative">
                    <div className="space-y-0">
                      {[
                        {
                          section: "Hero Section",
                          color: "bg-blue-500",
                          elements: [
                            "Attention-grabbing headline",
                            "Compelling subheadline",
                            "Hero image or video",
                            "Primary CTA button",
                          ],
                        },
                        {
                          section: "Problem Section",
                          color: "bg-red-500",
                          elements: [
                            "Identify the pain point",
                            "Agitate the problem",
                            "Show you understand their struggle",
                          ],
                        },
                        {
                          section: "Solution Section",
                          color: "bg-green-500",
                          elements: [
                            "Introduce your product",
                            "Explain how it solves the problem",
                            "Highlight unique approach",
                          ],
                        },
                        {
                          section: "Features & Benefits",
                          color: "bg-purple-500",
                          elements: ["List key features", "Translate to benefits", "Use icons and visuals"],
                        },
                        {
                          section: "Social Proof",
                          color: "bg-orange-500",
                          elements: ["Customer testimonials", "Case studies", "Statistics and results", "Trust badges"],
                        },
                        {
                          section: "Pricing",
                          color: "bg-yellow-500",
                          elements: [
                            "Clear pricing display",
                            "Value comparison",
                            "Guarantee statement",
                            "Scarcity elements",
                          ],
                        },
                        {
                          section: "FAQ Section",
                          color: "bg-teal-500",
                          elements: ["Address common objections", "Build trust", "Reduce friction"],
                        },
                        {
                          section: "Final CTA",
                          color: "bg-pink-500",
                          elements: [
                            "Compelling call to action",
                            "Urgency element",
                            "Risk reversal",
                            "Clear next step",
                          ],
                        },
                      ].map((item, i) => (
                        <div key={i} className="flex border-b border-gray-100 last:border-0">
                          <div className={`w-2 ${item.color}`} />
                          <div className="flex-1 p-4">
                            <h5 className="font-semibold text-gray-900 mb-2">{item.section}</h5>
                            <div className="flex flex-wrap gap-2">
                              {item.elements.map((el, j) => (
                                <span key={j} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                  {el}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Copywriting Tips for Sales Pages</h3>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Heading1 className="w-5 h-5 text-blue-600" />
                      Headlines That Hook
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Your headline is the most important element. It should:
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Address a specific pain point</li>
                      <li>• Promise a clear benefit</li>
                      <li>• Create curiosity</li>
                      <li>• Be specific, not vague</li>
                    </ul>
                    <div className="mt-4 p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Good Example:</p>
                      <p className="text-sm font-medium text-green-700">
                        "Learn Digital Marketing in 30 Days—Even If You've Never Run an Ad Before"
                      </p>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-purple-600" />
                      Persuasive Body Copy
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">Guide readers through a logical progression:</p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Use short paragraphs (2-3 sentences)</li>
                      <li>• Include bullet points for scannability</li>
                      <li>• Write in second person (you, your)</li>
                      <li>• Use power words that evoke emotion</li>
                    </ul>
                    <div className="mt-4 p-3 bg-purple-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Power Words:</p>
                      <p className="text-sm text-purple-700">
                        Free, Proven, Instant, Secret, Exclusive, Limited, Guaranteed
                      </p>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <MousePointer className="w-5 h-5 text-green-600" />
                      Call-to-Action Buttons
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">Your CTA buttons should compel action:</p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Use action verbs (Get, Start, Join, Claim)</li>
                      <li>• Create urgency when appropriate</li>
                      <li>• Make buttons stand out visually</li>
                      <li>• Place CTAs strategically throughout</li>
                    </ul>
                    <div className="mt-4 space-y-2">
                      <Button className="w-full bg-green-600 hover:bg-green-700">Get Instant Access Now</Button>
                      <Button variant="outline" className="w-full border-green-600 text-green-600 bg-transparent">
                        Start Your Free Trial
                      </Button>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5 text-orange-600" />
                      Trust Elements
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">Reduce purchase anxiety with trust signals:</p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li>• Money-back guarantee badge</li>
                      <li>• Secure payment icons</li>
                      <li>• Customer count or testimonials</li>
                      <li>• Media mentions or certifications</li>
                    </ul>
                    <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
                      <div className="flex items-center gap-1">
                        <Shield className="w-4 h-4 text-green-500" />
                        <span>Secure</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <RefreshCw className="w-4 h-4 text-blue-500" />
                        <span>30-Day Refund</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <span>Instant Access</span>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Using the Page Builder</h3>

                <p className="mb-6">Affilova's drag-and-drop page builder includes all the elements you need:</p>

                <div className="bg-gray-900 rounded-xl p-6 my-8 text-white">
                  <h4 className="font-bold mb-4">Available Components</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { icon: Type, name: "Text Blocks" },
                      { icon: ImageIcon, name: "Images" },
                      { icon: Video, name: "Videos" },
                      { icon: Square, name: "Buttons" },
                      { icon: Columns, name: "Columns" },
                      { icon: Quote, name: "Testimonials" },
                      { icon: List, name: "Feature Lists" },
                      { icon: DollarSign, name: "Pricing Tables" },
                      { icon: HelpCircle, name: "FAQ Accordion" },
                      { icon: Clock, name: "Countdown Timer" },
                      { icon: Mail, name: "Opt-in Forms" },
                      { icon: Share2, name: "Social Proof" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-white/10 rounded-lg">
                        <item.icon className="w-4 h-4" />
                        <span className="text-sm">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 8: Payment Processing */}
            <section id="payment-processing" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Payment Processing</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Affilova partners with Squad to provide secure, reliable payment processing for all transactions. This
                  section explains how payments work on our platform.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Supported Payment Methods</h3>

                <div className="grid md:grid-cols-3 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <CreditCard className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">Card Payments</h4>
                    <p className="text-sm text-gray-600">
                      Visa, Mastercard, and Verve cards accepted for instant payments
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Building className="w-12 h-12 text-green-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">Bank Transfer</h4>
                    <p className="text-sm text-gray-600">Direct bank transfers from any Nigerian bank account</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Smartphone className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">USSD</h4>
                    <p className="text-sm text-gray-600">Pay using USSD codes—no internet required</p>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Payment Flow</h3>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {[
                      { step: 1, title: "Customer Pays", icon: ShoppingCart },
                      { step: 2, title: "Payment Processed", icon: Shield },
                      { step: 3, title: "Product Delivered", icon: Download },
                      { step: 4, title: "Commission Split", icon: Percent },
                      { step: 5, title: "Weekly Payout", icon: Wallet },
                    ].map((item, i) => (
                      <div key={i} className="flex md:flex-col items-center gap-3 md:text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center border-2 border-green-500 shadow-md">
                          <item.icon className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">Step {item.step}</div>
                          <div className="font-medium text-gray-900 text-sm">{item.title}</div>
                        </div>
                        {i < 4 && <ArrowRight className="hidden md:block w-6 h-6 text-gray-300 mx-2" />}
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Transaction Fees</h3>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Transaction Type</th>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Fee</th>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Cap</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-6 py-4 text-gray-600">Card Payments</td>
                        <td className="px-6 py-4 text-gray-600">1.5%</td>
                        <td className="px-6 py-4 text-gray-600">₦2,000</td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-gray-600">Bank Transfer</td>
                        <td className="px-6 py-4 text-gray-600">1.5%</td>
                        <td className="px-6 py-4 text-gray-600">₦2,000</td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-gray-600">USSD</td>
                        <td className="px-6 py-4 text-gray-600">1.5%</td>
                        <td className="px-6 py-4 text-gray-600">₦2,000</td>
                      </tr>
                      <tr className="bg-green-50">
                        <td className="px-6 py-4 text-green-700 font-medium">Withdrawal to Bank</td>
                        <td className="px-6 py-4 text-green-700 font-medium">Free</td>
                        <td className="px-6 py-4 text-green-700 font-medium">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Info className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-blue-800 mb-2">Fee Responsibility</h4>
                      <p className="text-blue-700 text-sm">
                        Transaction fees are deducted from the sale amount before commission split. For example, on a
                        ₦10,000 sale with 1.5% fee (₦150), the remaining ₦9,850 is split between vendor and affiliate
                        according to the commission rate.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 9: Analytics & Tracking */}
            <section id="analytics-tracking" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-indigo-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Analytics & Tracking</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Data-driven decisions are the key to scaling your affiliate business. Affilova provides comprehensive
                  analytics to help you understand and optimize your performance.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Key Metrics Explained</h3>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  {[
                    {
                      icon: Eye,
                      title: "Impressions",
                      desc: "Number of times your product or link was displayed to potential customers",
                      formula: "Total views across all platforms",
                    },
                    {
                      icon: MousePointer,
                      title: "Clicks",
                      desc: "Number of times users clicked on your affiliate link",
                      formula: "Unique and total click tracking",
                    },
                    {
                      icon: Target,
                      title: "Click-Through Rate (CTR)",
                      desc: "Percentage of impressions that resulted in clicks",
                      formula: "(Clicks ÷ Impressions) × 100",
                    },
                    {
                      icon: ShoppingCart,
                      title: "Conversions",
                      desc: "Number of clicks that resulted in completed purchases",
                      formula: "Successful transactions from your link",
                    },
                    {
                      icon: Percent,
                      title: "Conversion Rate",
                      desc: "Percentage of clicks that converted to sales",
                      formula: "(Conversions ÷ Clicks) × 100",
                    },
                    {
                      icon: DollarSign,
                      title: "Earnings Per Click (EPC)",
                      desc: "Average amount earned for each click",
                      formula: "Total Earnings ÷ Total Clicks",
                    },
                    {
                      icon: Calculator,
                      title: "Average Order Value (AOV)",
                      desc: "Average amount per transaction",
                      formula: "Total Revenue ÷ Number of Orders",
                    },
                    {
                      icon: TrendingUp,
                      title: "Revenue Growth",
                      desc: "Change in revenue over time periods",
                      formula: "((Current - Previous) ÷ Previous) × 100",
                    },
                  ].map((metric, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-xl p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <metric.icon className="w-5 h-5 text-indigo-600" />
                        </div>
                        <h4 className="font-bold text-gray-900">{metric.title}</h4>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{metric.desc}</p>
                      <div className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded inline-block">
                        {metric.formula}
                      </div>
                    </div>
                  ))}
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Dashboard Reports</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Available Report Types</h4>

                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                      <LineChart className="w-6 h-6 text-blue-600 flex-shrink-0" />
                      <div>
                        <h5 className="font-medium text-gray-900">Performance Over Time</h5>
                        <p className="text-sm text-gray-600">
                          Track clicks, conversions, and revenue across daily, weekly, monthly, or custom date ranges
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                      <PieChart className="w-6 h-6 text-green-600 flex-shrink-0" />
                      <div>
                        <h5 className="font-medium text-gray-900">Traffic Sources</h5>
                        <p className="text-sm text-gray-600">
                          See where your traffic comes from—social media, email, direct links, etc.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                      <Package className="w-6 h-6 text-purple-600 flex-shrink-0" />
                      <div>
                        <h5 className="font-medium text-gray-900">Product Performance</h5>
                        <p className="text-sm text-gray-600">
                          Compare performance across different products to identify top performers
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                      <Users className="w-6 h-6 text-orange-600 flex-shrink-0" />
                      <div>
                        <h5 className="font-medium text-gray-900">Affiliate Leaderboard</h5>
                        <p className="text-sm text-gray-600">
                          For vendors: see which affiliates are driving the most sales
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                      <Globe className="w-6 h-6 text-teal-600 flex-shrink-0" />
                      <div>
                        <h5 className="font-medium text-gray-900">Geographic Data</h5>
                        <p className="text-sm text-gray-600">Understand where your customers and traffic are located</p>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Using Data to Optimize</h3>

                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-8 my-8 text-white">
                  <h4 className="text-xl font-bold mb-6">Optimization Framework</h4>

                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="bg-white/10 rounded-xl p-4">
                      <h5 className="font-semibold mb-3">Low CTR?</h5>
                      <ul className="space-y-2 text-sm text-indigo-100">
                        <li>• Improve ad copy and headlines</li>
                        <li>• Test different images</li>
                        <li>• Refine targeting</li>
                        <li>• A/B test CTAs</li>
                      </ul>
                    </div>

                    <div className="bg-white/10 rounded-xl p-4">
                      <h5 className="font-semibold mb-3">Low Conversion Rate?</h5>
                      <ul className="space-y-2 text-sm text-indigo-100">
                        <li>• Improve sales page</li>
                        <li>• Check price positioning</li>
                        <li>• Add more social proof</li>
                        <li>• Reduce friction</li>
                      </ul>
                    </div>

                    <div className="bg-white/10 rounded-xl p-4">
                      <h5 className="font-semibold mb-3">Low EPC?</h5>
                      <ul className="space-y-2 text-sm text-indigo-100">
                        <li>• Promote higher-priced products</li>
                        <li>• Seek better commission rates</li>
                        <li>• Focus on warmer audiences</li>
                        <li>• Add upsells</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 10: Marketing Strategies */}
            <section id="marketing-strategies" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                  <Megaphone className="w-6 h-6 text-red-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Marketing Strategies</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Success in affiliate marketing requires a strategic approach to promotion. This section covers proven
                  marketing strategies that top affiliates use to generate consistent sales.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Content Marketing Strategy</h3>

                <p className="mb-6">
                  Content marketing is the foundation of sustainable affiliate income. By creating valuable content, you
                  attract and nurture potential customers naturally.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Content Funnel Approach</h4>

                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-24 flex-shrink-0">
                        <div className="bg-blue-100 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-blue-600">TOFU</div>
                          <div className="text-xs text-blue-500">Top of Funnel</div>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900 mb-2">Awareness Content</h5>
                        <p className="text-sm text-gray-600 mb-2">
                          Attract new audiences with educational, entertaining, or inspirational content.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Blog posts</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Social media</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">YouTube videos</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Podcasts</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-24 flex-shrink-0">
                        <div className="bg-yellow-100 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-yellow-600">MOFU</div>
                          <div className="text-xs text-yellow-600">Middle of Funnel</div>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900 mb-2">Consideration Content</h5>
                        <p className="text-sm text-gray-600 mb-2">
                          Help prospects evaluate solutions and understand their options.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Comparison articles</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Case studies</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Webinars</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Email sequences</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <div className="w-24 flex-shrink-0">
                        <div className="bg-green-100 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-green-600">BOFU</div>
                          <div className="text-xs text-green-600">Bottom of Funnel</div>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900 mb-2">Decision Content</h5>
                        <p className="text-sm text-gray-600 mb-2">
                          Convert interested prospects into buyers with compelling offers.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Product reviews</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Testimonials</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Limited offers</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">Bonuses</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Email Marketing Mastery</h3>

                <p className="mb-6">
                  Email remains the highest-converting channel for affiliate marketing. Here's how to build and leverage
                  your email list effectively:
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <UserPlus className="w-5 h-5 text-blue-600" />
                      Building Your List
                    </h4>
                    <ul className="space-y-3 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Create valuable lead magnets (free guides, checklists, templates)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Place opt-in forms strategically on your content</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Use exit-intent popups to capture leaving visitors</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Run giveaways and contests</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Mail className="w-5 h-5 text-purple-600" />
                      Email Sequence Types
                    </h4>
                    <ul className="space-y-3 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                        <span>
                          <strong>Welcome Sequence:</strong> Introduce yourself and build trust (3-5 emails)
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                        <span>
                          <strong>Nurture Sequence:</strong> Provide value and establish expertise
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full mt-1.5 flex-shrink-0" />
                        <span>
                          <strong>Launch Sequence:</strong> Promote specific products with urgency
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full mt-1.5 flex-shrink-0" />
                        <span>
                          <strong>Re-engagement:</strong> Win back inactive subscribers
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Flame className="w-6 h-6 text-orange-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-orange-800 mb-2">Email Subject Line Tips</h4>
                      <p className="text-sm text-orange-700 mb-3">
                        Your subject line determines whether your email gets opened. Use these formulas:
                      </p>
                      <ul className="space-y-1 text-sm text-orange-700">
                        <li>
                          • <strong>Curiosity:</strong> "The weird trick that doubled my income"
                        </li>
                        <li>
                          • <strong>Urgency:</strong> "Last chance: Offer expires tonight"
                        </li>
                        <li>
                          • <strong>Personal:</strong> "Quick question, [Name]"
                        </li>
                        <li>
                          • <strong>Value:</strong> "Free guide: 10 ways to increase conversions"
                        </li>
                        <li>
                          • <strong>Social proof:</strong> "How [Name] made ₦500k in 30 days"
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Social Media Marketing</h3>

                <p className="mb-6">
                  Each social platform requires a unique approach. Here's how to maximize your impact on the most
                  effective platforms for affiliate marketing:
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-4 text-left font-medium text-gray-700">Platform</th>
                          <th className="px-6 py-4 text-left font-medium text-gray-700">Best For</th>
                          <th className="px-6 py-4 text-left font-medium text-gray-700">Content Type</th>
                          <th className="px-6 py-4 text-left font-medium text-gray-700">Posting Frequency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr>
                          <td className="px-6 py-4 font-medium text-gray-900">Instagram</td>
                          <td className="px-6 py-4 text-gray-600">Lifestyle, Visual products</td>
                          <td className="px-6 py-4 text-gray-600">Reels, Stories, Carousels</td>
                          <td className="px-6 py-4 text-gray-600">1-2 posts/day</td>
                        </tr>
                        <tr>
                          <td className="px-6 py-4 font-medium text-gray-900">YouTube</td>
                          <td className="px-6 py-4 text-gray-600">Reviews, Tutorials</td>
                          <td className="px-6 py-4 text-gray-600">Long-form video</td>
                          <td className="px-6 py-4 text-gray-600">1-2 videos/week</td>
                        </tr>
                        <tr>
                          <td className="px-6 py-4 font-medium text-gray-900">Twitter/X</td>
                          <td className="px-6 py-4 text-gray-600">Authority building</td>
                          <td className="px-6 py-4 text-gray-600">Threads, Tips</td>
                          <td className="px-6 py-4 text-gray-600">3-5 tweets/day</td>
                        </tr>
                        <tr>
                          <td className="px-6 py-4 font-medium text-gray-900">TikTok</td>
                          <td className="px-6 py-4 text-gray-600">Viral content, Gen Z</td>
                          <td className="px-6 py-4 text-gray-600">Short videos</td>
                          <td className="px-6 py-4 text-gray-600">1-3 videos/day</td>
                        </tr>
                        <tr>
                          <td className="px-6 py-4 font-medium text-gray-900">LinkedIn</td>
                          <td className="px-6 py-4 text-gray-600">B2B, Professional</td>
                          <td className="px-6 py-4 text-gray-600">Articles, Posts</td>
                          <td className="px-6 py-4 text-gray-600">1 post/day</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 11: Commission Structure */}
            <section id="commission-structure" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <CircleDollarSign className="w-6 h-6 text-yellow-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Commission Structure</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Understanding how commissions work on Affilova is essential for maximizing your earnings. This section
                  breaks down the complete commission structure for both vendors and affiliates.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">How Commissions Are Calculated</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Commission Breakdown Example</h4>

                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="text-center mb-4">
                      <span className="text-3xl font-bold text-gray-900">₦10,000</span>
                      <span className="text-gray-500 ml-2">Product Price</span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-white rounded border">
                        <span className="text-gray-600">Transaction Fee (1.5%)</span>
                        <span className="font-medium text-red-600">- ₦150</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-white rounded border">
                        <span className="text-gray-600">Net Amount</span>
                        <span className="font-medium text-gray-900">₦9,850</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-green-50 rounded border border-green-200">
                        <span className="text-green-700">Affiliate Commission (30%)</span>
                        <span className="font-bold text-green-600">₦2,955</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-blue-50 rounded border border-blue-200">
                        <span className="text-blue-700">Vendor Earnings (70%)</span>
                        <span className="font-bold text-blue-600">₦6,895</span>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Commission Rate Guidelines</h3>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4">For Vendors: Setting Rates</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Finding the right commission rate balances affiliate motivation with your profit margins:
                    </p>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-700">Low Commission</span>
                        <span className="font-medium text-gray-900">10-20%</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                        <span className="text-gray-700">Standard</span>
                        <span className="font-medium text-gray-900">25-35%</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                        <span className="text-gray-700">Competitive</span>
                        <span className="font-medium text-gray-900">40-50%</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                        <span className="text-gray-700">Premium</span>
                        <span className="font-medium text-gray-900">50-75%</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4">For Affiliates: What to Look For</h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Higher commission isn't always better. Consider these factors:
                    </p>
                    <ul className="space-y-3 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Earnings Per Sale:</strong> ₦5k at 30% beats ₦2k at 50%
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Conversion Rate:</strong> How well does the product sell?
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Refund Rate:</strong> Lower refunds = more stable income
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>
                          <strong>Cookie Duration:</strong> Longer = more credit for delayed purchases
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Cookie Duration & Attribution</h3>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-blue-800 mb-4">How Cookie Tracking</h4>
                </div>
              </div>
            </section>

            {/* Section 12: Payout System */}
            <section id="payout-system" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-cyan-100 rounded-xl flex items-center justify-center">
                  <Banknote className="w-6 h-6 text-cyan-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Payout System</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Get paid on time, every time. Affilova's payout system is designed for reliability and transparency,
                  ensuring you receive your hard-earned commissions without hassle.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Weekly Payouts Guarantee</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="text-center md:text-left">
                      <h4 className="font-bold text-gray-900 mb-2">Payout Day: Every Thursday</h4>
                      <p className="text-gray-600 text-sm">
                        All commissions earned and processed by Wednesday 11:59 PM are paid out on Thursday.
                      </p>
                    </div>
                    <div className="text-center md:text-right">
                      <h4 className="font-bold text-gray-900 mb-2">No Minimum Thresholds</h4>
                      <p className="text-gray-600 text-sm">
                        You get paid for every sale you make. No minimum payout required.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Payout Process Overview</h3>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {[
                      { step: 1, title: "Earn Commissions", icon: TrendingUp },
                      { step: 2, title: "Sales Approved", icon: CheckCircle },
                      { step: 3, title: "Payout Processed", icon: Wallet },
                      { step: 4, title: "Funds Received", icon: Building },
                    ].map((item, i) => (
                      <div key={i} className="flex md:flex-col items-center gap-3 md:text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center border-2 border-cyan-500 shadow-md">
                          <item.icon className="w-5 h-5 text-cyan-600" />
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">Step {item.step}</div>
                          <div className="font-medium text-gray-900 text-sm">{item.title}</div>
                        </div>
                        {i < 3 && <ArrowRight className="hidden md:block w-6 h-6 text-gray-300 mx-2" />}
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Payout History & Tracking</h3>

                <p className="mb-6">
                  Monitor your earnings and payout history directly from your dashboard. All past transactions are
                  recorded for your reference.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-8">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Date</th>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Amount</th>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Status</th>
                        <th className="px-6 py-4 text-left font-medium text-gray-700">Reference ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="px-6 py-4 text-gray-600">2025-12-05</td>
                        <td className="px-6 py-4 text-gray-600">₦15,500.00</td>
                        <td className="px-6 py-4">
                          <Badge className="bg-green-100 text-green-700">Completed</Badge>
                        </td>
                        <td className="px-6 py-4 text-gray-500">PAY12345XYZ</td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-gray-600">2025-11-28</td>
                        <td className="px-6 py-4 text-gray-600">₦12,000.00</td>
                        <td className="px-6 py-4">
                          <Badge className="bg-green-100 text-green-700">Completed</Badge>
                        </td>
                        <td className="px-6 py-4 text-gray-500">PAY67890ABC</td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-gray-600">2025-11-21</td>
                        <td className="px-6 py-4 text-gray-600">₦9,875.50</td>
                        <td className="px-6 py-4">
                          <Badge className="bg-green-100 text-green-700">Completed</Badge>
                        </td>
                        <td className="px-6 py-4 text-gray-500">PAYDEF12345</td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-gray-600">2025-11-14</td>
                        <td className="px-6 py-4 text-gray-600">₦18,250.00</td>
                        <td className="px-6 py-4">
                          <Badge className="bg-green-100 text-green-700">Completed</Badge>
                        </td>
                        <td className="px-6 py-4 text-gray-500">PAYGHI67890</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Section 13: Security & Compliance */}
            <section id="security-compliance" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-gray-200 rounded-xl flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-gray-700" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Security & Compliance</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Your security and data privacy are paramount. Affilova adheres to strict security protocols and
                  compliance standards to protect your information and ensure a trustworthy environment.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Data Protection & Privacy</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Lock className="w-5 h-5 text-blue-600" />
                    Encryption Standards
                  </h4>
                  <p className="text-sm text-gray-600 mb-4">
                    We employ industry-standard 256-bit SSL encryption to secure all data transmitted between your
                    browser and our servers, protecting sensitive information like login credentials and payment
                    details.
                  </p>
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-green-600" />
                    Regular Security Audits
                  </h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Our platform undergoes regular security audits and vulnerability assessments by third-party experts
                    to identify and address potential threats proactively.
                  </p>
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-purple-600" />
                    Compliance with Regulations
                  </h4>
                  <p className="text-sm text-gray-600">
                    We are committed to complying with relevant data protection regulations, including GDPR and local
                    Nigerian data privacy laws, ensuring your rights are respected.
                  </p>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Account Security Best Practices</h3>

                <p className="mb-6">
                  While we implement robust security measures, user vigilance is also crucial. Here are best practices
                  to keep your account secure:
                </p>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-gray-50 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Key className="w-5 h-5 text-blue-600" />
                      Password Management
                    </h4>
                    <ul className="space-y-3 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Use strong, unique passwords for Affilova</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Avoid sharing your password with anyone</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Change your password regularly</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Smartphone className="w-5 h-5 text-green-600" />
                      Enable Two-Factor Authentication (2FA)
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      As mentioned in the Account Setup section, 2FA adds a critical layer of security. We highly
                      recommend enabling it via an authenticator app.
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Mail className="w-5 h-5 text-purple-600" />
                      Be Wary of Phishing
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Never click on suspicious links in emails or messages asking for your login details or personal
                      information. Affilova will never ask for your password via email.
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-6">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-orange-600" />
                      Secure Devices & Networks
                    </h4>
                    <p className="text-sm text-gray-600 mb-4">
                      Access your Affilova account from trusted devices and secure networks. Avoid public Wi-Fi for
                      sensitive transactions.
                    </p>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Compliance with Payment Processors</h3>

                <p className="mb-6">
                  Our payment processing partner, Squad, is PCI-DSS Level 1 compliant. This means they meet the highest
                  industry standards for handling cardholder data securely.
                </p>

                <div className="bg-green-50 border border-green-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Info className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-green-800 mb-2">PCI-DSS Compliance</h4>
                      <p className="text-green-700 text-sm">
                        Payment Card Industry Data Security Standard (PCI-DSS) is a set of security standards designed
                        to ensure that all companies that accept, process, store or transmit credit card information
                        maintain a secure environment.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 14: Advanced Features */}
            <section id="advanced-features" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
                  <SlidersHorizontal className="w-6 h-6 text-teal-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Advanced Features</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Go beyond the basics with Affilova's advanced features designed to give you a competitive edge and
                  unlock new revenue streams.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Affiliate Tiers and Bonuses</h3>

                <p className="mb-6">
                  Motivate your affiliates with tiered commission structures and performance-based bonuses. This
                  encourages them to drive more sales and become power promoters of your products.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Tiered Commission Structure</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Tier</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Sales Target</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Commission Rate</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Bonuses</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr>
                          <td className="px-4 py-2">Bronze</td>
                          <td className="px-4 py-2">0-10 sales</td>
                          <td className="px-4 py-2">30%</td>
                          <td className="px-4 py-2">None</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2">Silver</td>
                          <td className="px-4 py-2">11-50 sales</td>
                          <td className="px-4 py-2">35%</td>
                          <td className="px-4 py-2">Monthly top performer bonus</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2">Gold</td>
                          <td className="px-4 py-2">51-150 sales</td>
                          <td className="px-4 py-2">40%</td>
                          <td className="px-4 py-2">Quarterly bonus + early access to new products</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2">Platinum</td>
                          <td className="px-4 py-2">151+ sales</td>
                          <td className="px-4 py-2">45%</td>
                          <td className="px-4 py-2">Annual bonus + dedicated support</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Customizable Affiliate Links</h3>

                <p className="mb-6">
                  Provide your affiliates with the flexibility to create custom affiliate links that align with their
                  specific marketing campaigns and landing pages.
                </p>

                <div className="bg-teal-50 border border-teal-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Link2 className="w-6 h-6 text-teal-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-teal-800 mb-2">Benefits of Custom Links</h4>
                      <p className="text-teal-700 text-sm">
                        Custom links allow affiliates to track the performance of specific promotions (e.g., an
                        Instagram campaign vs. a blog post) more accurately, leading to better optimization and higher
                        earnings.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Upselling & Cross-selling Capabilities</h3>

                <p className="mb-6">
                  Maximize customer lifetime value by implementing upsell and cross-sell strategies within your sales
                  funnel.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <h4 className="font-bold text-gray-900 mb-4">Upsell Strategies</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Offer a higher-value version of the product at the point of purchase.
                  </p>
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <DollarSign className="w-5 h-5 text-green-600" />
                      <h5 className="font-medium text-gray-900">Example:</h5>
                    </div>
                    <p className="text-sm text-gray-600">
                      Customer buys "Basic Marketing Course" for ₦10,000. Offer "Premium Course + Coaching" for an
                      additional ₦5,000.
                    </p>
                  </div>
                  <h4 className="font-bold text-gray-900 mb-4">Cross-sell Strategies</h4>
                  <p className="text-sm text-gray-600">
                    Recommend complementary products that enhance the value of the initial purchase.
                  </p>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Tag className="w-5 h-5 text-purple-600" />
                      <h5 className="font-medium text-gray-900">Example:</h5>
                    </div>
                    <p className="text-sm text-gray-600">
                      Customer buys "Email Marketing Course". Recommend "Sales Page Builder" or "Social Media Marketing
                      Toolkit" at checkout or in follow-up emails.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 15: Integrations */}
            <section id="integrations" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center">
                  <Link2 className="w-6 h-6 text-sky-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Integrations</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Seamlessly connect Affilova with your favorite marketing and business tools to streamline your
                  workflow and enhance your results.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Email Marketing Integrations</h3>

                <div className="grid md:grid-cols-3 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Mail className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">ActiveCampaign</h4>
                    <p className="text-sm text-gray-600">Sync leads and manage email campaigns automatically</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Mail className="w-12 h-12 text-green-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">MailerLite</h4>
                    <p className="text-sm text-gray-600">
                      Connect your MailerLite account for effortless lead nurturing
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Mail className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">GetResponse</h4>
                    <p className="text-sm text-gray-600">Integrate with GetResponse to automate your email marketing</p>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Payment Gateway Integrations</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="text-center">
                      <img src="/squad-logo.png" alt="Squad" className="h-12 w-auto mx-auto mb-4" />
                      <h4 className="font-bold text-gray-900 mb-2">Squad</h4>
                      <p className="text-sm text-gray-600">Default payment gateway for secure local transactions</p>
                    </div>
                    {/* Placeholder for potential future integrations */}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Analytics & Tracking Tools</h3>

                <div className="grid md:grid-cols-3 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <BarChart3 className="w-12 h-12 text-orange-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">Google Analytics</h4>
                    <p className="text-sm text-gray-600">Track website traffic and user behavior</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Tag className="w-12 h-12 text-red-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">Facebook Pixel</h4>
                    <p className="text-sm text-gray-600">Retarget visitors and track ad campaign performance</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                    <Target className="w-12 h-12 text-indigo-600 mx-auto mb-4" />
                    <h4 className="font-bold text-gray-900 mb-2">Other Tracking Codes</h4>
                    <p className="text-sm text-gray-600">
                      Support for custom tracking scripts (e.g., Google Tag Manager)
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 16: Mobile Experience */}
            <section id="mobile-app" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-purple-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Mobile Experience</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Access and manage your Affilova account anytime, anywhere. Our platform is fully responsive and
                  optimized for a seamless experience on all devices.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Responsive Design</h3>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <div className="grid md:grid-cols-3 gap-6">
                    <div className="text-center">
                      <Monitor className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                      <h4 className="font-bold text-gray-900 mb-2">Desktop</h4>
                      <p className="text-sm text-gray-600">
                        Full access to all features and detailed analytics on larger screens.
                      </p>
                    </div>

                    <div className="text-center">
                      <Tablet className="w-12 h-12 text-green-600 mx-auto mb-4" />
                      <h4 className="font-bold text-gray-900 mb-2">Tablet</h4>
                      <p className="text-sm text-gray-600">
                        Optimized layout for touch interactions and comfortable viewing.
                      </p>
                    </div>

                    <div className="text-center">
                      <Smartphone className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                      <h4 className="font-bold text-gray-900 mb-2">Mobile Phone</h4>
                      <p className="text-sm text-gray-600">
                        Intuitive navigation and quick access to key metrics on the go.
                      </p>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Mobile Dashboard Features</h3>

                <p className="mb-6">Manage your core business functions directly from your mobile device:</p>

                <div className="bg-gray-900 rounded-xl p-6 my-8 text-white">
                  <h4 className="font-bold mb-4">Key Mobile Features</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { icon: BarChart3, name: "View Key Metrics" },
                      { icon: Megaphone, name: "Manage Promotions" },
                      { icon: Upload, name: "Track Sales" },
                      { icon: Users, name: "Monitor Affiliates" },
                      { icon: Wallet, name: "Check Earnings" },
                      { icon: Settings, name: "Update Profile" },
                      { icon: HelpCircle, name: "Access Support" },
                      { icon: RefreshCw, name: "View Payout History" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-white/10 rounded-lg">
                        <item.icon className="w-4 h-4" />
                        <span className="text-sm">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Performance on Mobile</h3>

                <div className="bg-sky-50 border border-sky-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <Info className="w-6 h-6 text-sky-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-sky-800 mb-2">Always On, Always Optimized</h4>
                      <p className="text-sky-700 text-sm">
                        Whether you're in a meeting, on the go, or relaxing at home, Affilova is accessible and performs
                        optimally. Our mobile-first approach ensures a smooth experience for vendors and affiliates
                        alike.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 17: Support & Resources */}
            <section id="support-resources" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <HelpCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Support & Resources</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  We're committed to your success. Affilova offers a range of support channels and resources to help you
                  navigate the platform and achieve your goals.
                </p>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Customer Support Channels</h3>

                <div className="grid md:grid-cols-2 gap-6 my-8">
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Mail className="w-6 h-6 text-blue-600" />
                      <h4 className="font-bold text-gray-900">Email Support</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Reach out to our dedicated support team at support@affilova.com for assistance with any
                      platform-related inquiries. We aim to respond within 24 business hours.
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <MessageSquare className="w-6 h-6 text-green-600" />
                      <h4 className="font-bold text-gray-900">Live Chat</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Need a quick answer? Our live chat support is available during business hours for real-time
                      assistance. Look for the chat icon in the bottom right corner.
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <Building className="w-6 h-6 text-purple-600" />
                      <h4 className="font-bold text-gray-900">Vendor Support</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Vendors receive priority support and can also access dedicated resources within their dashboard to
                      optimize their product listings and affiliate programs.
                    </p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <TrendingUp className="w-6 h-6 text-orange-600" />
                      <h4 className="font-bold text-gray-900">Affiliate Success Team</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Our Affiliate Success Managers are available to help affiliates maximize their earnings through
                      strategy guidance and performance tips.
                    </p>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Help Center & Knowledge Base</h3>

                <p className="mb-6">
                  Find answers to frequently asked questions, detailed guides, and tutorials in our comprehensive Help
                  Center.
                </p>

                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 my-8">
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-bold text-emerald-800 mb-2">Explore Our Knowledge Base</h4>
                      <p className="text-emerald-700 text-sm mb-4">
                        Our Help Center is constantly updated with articles covering:
                      </p>
                      <ul className="space-y-1 text-sm text-emerald-700">
                        <li>• Getting Started Guides</li>
                        <li>• Product Management Tutorials</li>
                        <li>• Affiliate Marketing Strategies</li>
                        <li>• Payment and Payout FAQs</li>
                        <li>• Troubleshooting Common Issues</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mt-12 mb-6">Community Forum</h3>

                <p className="mb-6">
                  Connect with other vendors and affiliates, share insights, ask questions, and learn from experienced
                  members of the Affilova community.
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-6 my-8">
                  <div className="flex items-center gap-3 mb-4">
                    <Users className="w-6 h-6 text-gray-600" />
                    <h4 className="font-bold text-gray-900">Affilova Community Forum</h4>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">
                    Engage in discussions, find partners, and get tips from fellow users. Our forum is a valuable
                    resource for learning and networking.
                  </p>
                  <Button
                    variant="outline"
                    className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 bg-transparent"
                  >
                    Visit the Forum
                  </Button>
                </div>
              </div>
            </section>

            {/* Section 18: Success Stories */}
            <section id="success-stories" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
                  <Award className="w-6 h-6 text-yellow-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Success Stories</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Discover how vendors and affiliates are achieving remarkable success with Affilova. Get inspired by
                  real-world examples and learn from their journeys.
                </p>

                <div className="grid md:grid-cols-2 gap-8 my-8">
                  {[
                    {
                      name: "Chidi Okoro",
                      role: "Vendor",
                      product: "Ultimate Freelancer's Toolkit",
                      story:
                        "Since launching on Affilova, my product has seen a 300% increase in sales. The affiliate recruitment tools have been invaluable in expanding my reach. I'm making more passive income than ever before!",
                      image: "/avatars/chidi.png",
                    },
                    {
                      name: "Amina Bello",
                      role: "Affiliate",
                      product: "Promotes multiple digital products",
                      story:
                        "Affilova has made affiliate marketing incredibly accessible. The real-time analytics allow me to see what's working, and the high commission rates on quality products mean I'm consistently earning a great income.",
                      image: "/avatars/amina.png",
                    },
                    {
                      name: "Emeka Nnamdi",
                      role: "Vendor",
                      product: "Mastering Python Course",
                      story:
                        "The ease of use for product upload and sales page creation is fantastic. My affiliates are actively promoting, and the weekly payouts mean I can reinvest in my business with confidence.",
                      image: "/avatars/emeka.png",
                    },
                    {
                      name: "Fatima Sani",
                      role: "Affiliate",
                      product: "Fitness & Nutrition Plans",
                      story:
                        "I love promoting products that genuinely help people. Affilova's marketplace has so many high-quality options. My audience trusts my recommendations, and my earnings reflect that trust.",
                      image: "/avatars/fatima.png",
                    },
                  ].map((story, i) => (
                    <div
                      key={i}
                      className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <img
                          src={story.image || "/placeholder.svg"}
                          alt={story.name}
                          className="w-16 h-16 rounded-full object-cover"
                        />
                        <div>
                          <h4 className="font-bold text-gray-900">{story.name}</h4>
                          <span className="text-sm text-gray-500">{story.role}</span>
                        </div>
                      </div>
                      <p className="text-gray-700 mb-4 italic text-sm">"{story.story}"</p>
                      <div className="text-sm font-medium text-gray-600">
                        {story.role === "Vendor" ? `Product: ${story.product}` : `Promoting: ${story.product}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Section 19: FAQ */}
            <section id="faq" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <HelpCircle className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Frequently Asked Questions</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  Find answers to common questions about using Affilova. If your question isn't answered here, please
                  contact our support team.
                </p>

                <div className="space-y-6 my-8">
                  {[
                    {
                      question: "How do I get started on Affilova?",
                      answer:
                        "Simply click the 'Get Started' button on our homepage and follow the easy registration process. You'll then choose whether to become a vendor or an affiliate.",
                    },
                    {
                      question: "What types of products can I sell as a vendor?",
                      answer:
                        "You can sell any type of digital product, including eBooks, courses, software, templates, music, videos, and more. We support a wide range of file formats.",
                    },
                    {
                      question: "What is the commission rate for affiliates?",
                      answer:
                        "Commission rates are set by vendors, but typically range from 20% to 75%. You can find the specific commission rate on each product's listing page in the marketplace.",
                    },
                    {
                      question: "When will I receive my payouts?",
                      answer:
                        "Affilova processes payouts every Thursday for all earnings finalized by Wednesday. There is no minimum payout threshold.",
                    },
                    {
                      question: "Are there any fees for using Affilova?",
                      answer:
                        "We charge a small transaction fee on sales to cover payment processing costs. Withdrawal to your bank account is free. Please see the 'Payment Processing' section for details.",
                    },
                    {
                      question: "Can I be both a vendor and an affiliate?",
                      answer:
                        "Absolutely! Many of our successful users leverage both roles. You can sell your own products and earn commissions by promoting others.",
                    },
                    {
                      question: "What if a customer requests a refund?",
                      answer:
                        "Refund policies are determined by the vendor. However, our platform facilitates a clear process for refund requests, and we handle chargebacks according to industry standards.",
                    },
                    {
                      question: "How is my data protected?",
                      answer:
                        "We use industry-standard encryption and security practices to protect your data. Please refer to our 'Security & Compliance' section for more details.",
                    },
                  ].map((faq, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-xl p-6">
                      <h4 className="font-bold text-gray-900 mb-3">
                        {i + 1}. {faq.question}
                      </h4>
                      <p className="text-sm text-gray-600">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Section 20: Next Steps */}
            <section id="next-steps" className="mb-20 scroll-mt-24">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <ChevronRight className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900">Next Steps</h2>
              </div>

              <div className="prose prose-lg max-w-none text-gray-600">
                <p className="text-xl leading-relaxed mb-6">
                  You've now explored the comprehensive workings of Affilova. Here are your next steps to get started on
                  your journey to digital commerce success:
                </p>

                <div className="bg-gray-50 rounded-xl p-6 my-8">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-green-600" />
                        Sign Up Today
                      </h4>
                      <p className="text-sm text-gray-600">
                        If you haven't already, create your Affilova account. It takes just a few minutes!
                      </p>
                      <Button
                        size="lg"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => window.open("/auth/register", "_blank")}
                      >
                        Get Started Now
                      </Button>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-blue-600" />
                        Explore Resources
                      </h4>
                      <p className="text-sm text-gray-600">
                        Dive deeper into our Help Center, join the community forum, and utilize our marketing guides.
                      </p>
                      <div className="flex gap-4">
                        <Button
                          variant="outline"
                          className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 bg-transparent"
                          onClick={() => scrollToSection("support-resources")}
                        >
                          Help Center
                        </Button>
                        <Button
                          variant="outline"
                          className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 bg-transparent"
                        >
                          Community Forum
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>

      <GlobalFooter />
    </div>
  )
}
