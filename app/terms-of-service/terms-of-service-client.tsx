"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ChevronRight, Menu, X, AlertCircle } from "lucide-react"
import GlobalFooter from "@/components/global-footer"

export default function TermsOfServiceClientPage() {
  const [activeSection, setActiveSection] = useState("agreement")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const sections = [
    { id: "agreement", title: "1. Agreement to Terms" },
    { id: "license", title: "2. Use License" },
    { id: "disclaimer", title: "3. Disclaimer" },
    { id: "limitations", title: "4. Limitations" },
    { id: "accuracy", title: "5. Accuracy of Materials" },
    { id: "links", title: "6. Third-Party Links" },
    { id: "modifications", title: "7. Modifications" },
    { id: "conduct", title: "8. User Conduct" },
    { id: "governing", title: "9. Governing Law" },
    { id: "contact", title: "10. Contact Information" },
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
            <img src="/affilova-logo.png" alt="Affilova" className="h-10 w-auto" />
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
              <h1 className="text-5xl font-bold text-gray-900 mb-4">Terms of Service</h1>
              <p className="text-lg text-gray-600">
                Last updated:{" "}
                {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>

            {/* Important Notice */}
            <div className="mb-8 bg-amber-50 border-l-4 border-amber-400 rounded-lg p-4 flex gap-3 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Important Notice</p>
                <p className="text-sm text-amber-800">
                  By accessing and using Affilova, you agree to be bound by these terms and conditions.
                </p>
              </div>
            </div>

            {/* Content Sections */}
            <div className="space-y-8">
              <section
                id="agreement"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">1. Agreement to Terms</h2>
                <p className="text-gray-700 leading-relaxed">
                  By accessing and using this website, you accept and agree to be bound by the terms and provision of
                  this agreement. If you do not agree to abide by the above, please do not use this service. Your
                  continued use of this service will be deemed as acceptance of these terms.
                </p>
              </section>

              <section
                id="license"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">2. Use License</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  Permission is granted to temporarily download one copy of the materials (information or software) on
                  Affilova's website for personal, non-commercial transitory viewing only. This is the grant of a
                  license, not a transfer of title.
                </p>
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    <strong>Restrictions:</strong> You may not modify, copy, distribute, transmit, display, perform,
                    reproduce, publish, license, create derivative works, or sell any information obtained from this
                    website.
                  </p>
                </div>
              </section>

              <section
                id="disclaimer"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">3. Disclaimer</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  The materials on Affilova's website are provided on an 'as is' basis. Affilova makes no warranties,
                  expressed or implied, and hereby disclaims and negates all other warranties.
                </p>
                <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded">
                  <p className="text-sm text-gray-700">
                    Further, Affilova does not warrant or make any representations concerning the accuracy, likely
                    results, or reliability of the use of materials on its website.
                  </p>
                </div>
              </section>

              <section
                id="limitations"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">4. Limitations</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  In no event shall Affilova or its suppliers be liable for any damages (including, without limitation,
                  damages for loss of data or profit, or due to business interruption) arising out of the use or
                  inability to use the materials on Affilova's website.
                </p>
              </section>

              <section
                id="accuracy"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">5. Accuracy of Materials</h2>
                <p className="text-gray-700 leading-relaxed">
                  The materials appearing on Affilova's website could include technical, typographical, or photographic
                  errors. Affilova does not warrant that any of the materials on its website are accurate, complete, or
                  current. Affilova may make changes to the materials contained on its website at any time without
                  notice.
                </p>
              </section>

              <section
                id="links"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">6. Third-Party Links</h2>
                <p className="text-gray-700 leading-relaxed">
                  Affilova has not reviewed all of the sites linked to its website and is not responsible for the
                  contents of any such linked site. The inclusion of any link does not imply endorsement by Affilova of
                  the site. Use of any such linked website is at the user's own risk.
                </p>
              </section>

              <section
                id="modifications"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">7. Modifications</h2>
                <p className="text-gray-700 leading-relaxed">
                  Affilova may revise these terms of service for its website at any time without notice. By using this
                  website, you are agreeing to be bound by the then current version of these terms of service.
                </p>
              </section>

              <section
                id="conduct"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">8. User Conduct</h2>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  You agree not to use this website in any way that violates any applicable law or regulation, or
                  infringes upon the rights of others:
                </p>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Do not submit false or misleading information</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Do not engage in any form of harassment or abuse</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Do not attempt to gain unauthorized access</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600">✓</span>
                    <span>Do not circumvent security measures</span>
                  </li>
                </ul>
              </section>

              <section
                id="governing"
                className="bg-white rounded-xl shadow-sm p-8 hover:shadow-md transition animate-fade-in"
              >
                <h2 className="text-3xl font-bold text-gray-900 mb-4">9. Governing Law</h2>
                <p className="text-gray-700 leading-relaxed">
                  These terms and conditions are governed by and construed in accordance with the laws of Nigeria, and
                  you irrevocably submit to the exclusive jurisdiction of the courts in that location.
                </p>
              </section>

              <section
                id="contact"
                className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl shadow-lg p-8 text-white animate-fade-in"
              >
                <h2 className="text-3xl font-bold mb-4">10. Contact Information</h2>
                <p className="mb-6 leading-relaxed">
                  If you have any questions about these Terms of Service, please contact us at:
                </p>
                <div className="space-y-2">
                  <p className="font-semibold">Email: support@affilova.com</p>
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
