"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ChevronRight, Menu, X } from "lucide-react"
import GlobalFooter from "@/components/global-footer"
import { Logo } from "@/components/brand/logo"

export default function PrivacyPolicyClientPage() {
  const [activeSection, setActiveSection] = useState("introduction")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const sections = [
    { id: "introduction", title: "1. Introduction" },
    { id: "information", title: "2. Information We Collect" },
    { id: "use", title: "3. Use of Your Information" },
    { id: "disclosure", title: "4. Disclosure of Your Information" },
    { id: "security", title: "5. Security of Your Information" },
    { id: "cookies", title: "6. Cookies and Tracking" },
    { id: "rights", title: "7. Your Privacy Rights" },
    { id: "retention", title: "8. Data Retention" },
    { id: "contact", title: "9. Contact Us" },
  ]

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.id)
          }
        })
      },
      { rootMargin: "-50% 0px -50% 0px" },
    )

    sections.forEach((section) => {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-2">
            <Logo variant="horizontal" className="h-10 w-auto" />
          </Link>
          <div className="hidden md:flex space-x-4">
            <Link href="/">
              <Button variant="ghost" className="text-gray-600">
                Back to Home
              </Button>
            </Link>
          </div>
          {/* Mobile Menu Button */}
          <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12 max-w-6xl flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Navigation Sidebar */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24 space-y-2">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Sections</h3>
              <nav className="space-y-1">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                      activeSection === section.id
                        ? "bg-green-100 text-green-700 font-semibold"
                        : "text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                    <span className="text-sm">{section.title}</span>
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="lg:col-span-3">
            {/* Hero */}
            <div className="mb-12 animate-fade-in">
              <h1 className="text-5xl font-bold text-gray-900 mb-4">Privacy Policy</h1>
              <p className="text-lg text-gray-600">
                Last updated:{" "}
                {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>

            {/* Content Sections */}
            <div className="space-y-12">
              <section
                id="introduction"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">1. Introduction</h2>
                <p className="text-gray-700 leading-relaxed">
                  Affilova ("we," "us," "our," or "Company") is committed to protecting your privacy. This Privacy
                  Policy explains how we collect, use, disclose, and safeguard your information when you visit our
                  website and use our services.
                </p>
              </section>

              <section
                id="information"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">2. Information We Collect</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  We collect information about you in a variety of ways. The information we may collect includes:
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  {[
                    {
                      title: "Personal Information",
                      items: ["Name", "Email address", "Phone number", "Profile details"],
                    },
                    {
                      title: "Financial Data",
                      items: ["Bank details", "Payment information", "Transaction history", "Payout records"],
                    },
                    {
                      title: "Technical Data",
                      items: ["IP address", "Browser type", "Device information", "Usage analytics"],
                    },
                    {
                      title: "Communication",
                      items: ["Support messages", "Feedback", "Marketing preferences", "Communication history"],
                    },
                  ].map((category, idx) => (
                    <div key={idx} className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4">
                      <h4 className="font-semibold text-gray-900 mb-2">{category.title}</h4>
                      <ul className="space-y-1">
                        {category.items.map((item, i) => (
                          <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-green-600 rounded-full"></span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section
                id="use"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">3. Use of Your Information</h2>
                <p className="text-gray-700 mb-6 leading-relaxed">
                  Having accurate information about you permits us to provide you with a smooth, efficient, and
                  customized experience. We use your information to:
                </p>
                <ul className="space-y-3">
                  {[
                    "Process your transactions and send related information",
                    "Generate analytics and improve our services",
                    "Send promotional communications (with your consent)",
                    "Respond to your inquiries and customer support requests",
                    "Monitor and prevent fraud and security threats",
                    "Comply with legal and regulatory obligations",
                  ].map((item, idx) => (
                    <li key={idx} className="flex gap-3 text-gray-700">
                      <span className="text-green-600 font-bold">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                id="disclosure"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">4. Disclosure of Your Information</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  We may share or disclose your information in the following situations:
                </p>
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded">
                  <ul className="space-y-2 text-gray-700">
                    <li>• To comply with applicable laws and regulations</li>
                    <li>• To enforce our Terms of Service and other agreements</li>
                    <li>• To protect against fraud and security threats</li>
                    <li>• With your explicit consent</li>
                    <li>• To trusted service providers who assist us in operations</li>
                  </ul>
                </div>
              </section>

              <section
                id="security"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">5. Security of Your Information</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  We implement comprehensive security measures to protect your personal information:
                </p>
                <div className="grid md:grid-cols-3 gap-4">
                  {[
                    { title: "Administrative", desc: "Access controls and monitoring" },
                    { title: "Technical", desc: "Encryption and firewalls" },
                    { title: "Physical", desc: "Secure data centers" },
                  ].map((item, idx) => (
                    <div key={idx} className="bg-green-50 rounded-lg p-4">
                      <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
                      <p className="text-sm text-gray-600">{item.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-gray-600 mt-4 italic">
                  However, no method of transmission over the Internet is 100% secure. We cannot guarantee absolute
                  security.
                </p>
              </section>

              <section
                id="cookies"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">6. Cookies and Tracking</h2>
                <p className="text-gray-700 leading-relaxed">
                  We use cookies and similar tracking technologies to enhance your experience, track user behavior, and
                  improve our services. You can control cookie preferences through your browser settings.
                </p>
              </section>

              <section
                id="rights"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">7. Your Privacy Rights</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  Depending on your location, you may have the following rights:
                </p>
                <ul className="space-y-2 text-gray-700">
                  <li>• Right to access your personal data</li>
                  <li>• Right to rectification of inaccurate data</li>
                  <li>• Right to erasure ("right to be forgotten")</li>
                  <li>• Right to restrict processing</li>
                  <li>• Right to data portability</li>
                </ul>
              </section>

              <section
                id="retention"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">8. Data Retention</h2>
                <p className="text-gray-700 leading-relaxed">
                  We retain your personal data for as long as necessary to provide our services and fulfill the purposes
                  outlined in this policy. You can request deletion of your data at any time, subject to legal
                  obligations.
                </p>
              </section>

              <section
                id="contact"
                className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl shadow-lg p-8 text-white animate-fade-in"
              >
                <h2 className="text-3xl font-bold mb-4">9. Contact Us</h2>
                <p className="mb-6 leading-relaxed">
                  If you have questions or concerns about this Privacy Policy or our privacy practices:
                </p>
                <div className="space-y-2">
                  <p className="font-semibold">Email: privacy@affilova.com</p>
                  <p className="font-semibold">Support Portal: support.affilova.com</p>
                  <p className="text-sm opacity-90">Response time: Within 48 hours</p>
                </div>
              </section>
            </div>

            {/* Footer CTA */}
            <div className="mt-12 p-8 bg-white rounded-xl shadow-sm text-center">
              <Link href="/">
                <Button className="bg-green-600 hover:bg-green-700 text-white px-8 py-3">Back to Home</Button>
              </Link>
            </div>
          </main>
        </div>
      </div>

      <GlobalFooter className="bg-gradient-to-br from-gray-50 to-gray-100" />

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
