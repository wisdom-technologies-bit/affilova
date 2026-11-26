import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Users,
  TrendUp,
  Shield,
  Lightning,
  Target,
  Medal,
  Globe,
  Heart,
} from "@/components/ds/icons"
import { Logo } from "@/components/brand/logo"

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface-subtle">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-3">
            <Logo variant="horizontal" className="h-10 w-auto" />
          </Link>
          <div className="flex space-x-4">
            <Link href="/sign-in">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/sign-up">
              <Button className="bg-green-600 hover:bg-green-700">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 text-center">
        <Badge className="mb-4 bg-green-100 text-green-800 hover:bg-green-100">Empowering Digital Commerce</Badge>
        <h1 className="text-5xl font-bold text-gray-900 mb-6">About Affilova</h1>
        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
          Affilova is a marketplace where vendors list their products, affiliates apply to promote them, and every
          sale and commission is recorded in one place.
        </p>
      </section>

      {/* Mission & Vision */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 gap-12">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <Target className="w-12 h-12 text-green-600 mb-4" />
              <CardTitle className="text-2xl">Our Mission</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 leading-relaxed">
                To democratize affiliate marketing by providing a transparent, efficient, and profitable platform where
                vendors can scale their businesses and affiliates can build sustainable income streams through
                performance-based partnerships.
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <Globe className="w-12 h-12 text-blue-600 mb-4" />
              <CardTitle className="text-2xl">Our Vision</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 leading-relaxed">
                To become the world's most trusted affiliate marketplace, fostering a global ecosystem where innovation
                meets opportunity, and where every transaction creates value for vendors, affiliates, and customers
                alike.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Our Story */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-8">Our Story</h2>
            <div className="prose prose-lg mx-auto text-gray-600">
              <p className="mb-6">
                Affilova was born from a simple observation: the affiliate marketing industry was fragmented, complex,
                and often unfair to both vendors and affiliates. Traditional platforms were either too expensive, too
                complicated, or simply didn't provide the tools needed for success.
              </p>
              <p className="mb-6">
                So we set out to build one platform with two roles in mind: vendors who want their products in front of
                more people, and affiliates who want to promote products they believe in. Everything a vendor lists is
                reviewed before it reaches the marketplace, and every commission rate is set by the vendor on the
                product itself.
              </p>
              <p>
                Affilova is built by Wisdom Technologies. What is written on this site describes what the platform does
                today, and nothing more.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Our Core Values</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <Card className="text-center border-0 shadow-lg">
            <CardHeader>
              <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <CardTitle>Transparency</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-sm">
                Clear pricing, honest reporting, and open communication in every interaction.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center border-0 shadow-lg">
            <CardHeader>
              <Heart className="w-12 h-12 text-red-600 mx-auto mb-4" />
              <CardTitle>Fairness</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-sm">
                Equitable commission structures and policies that benefit all parties.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center border-0 shadow-lg">
            <CardHeader>
              <Lightning className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
              <CardTitle>Innovation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-sm">
                Cutting-edge technology and features that stay ahead of industry trends.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center border-0 shadow-lg">
            <CardHeader>
              <Medal className="w-12 h-12 text-purple-600 mx-auto mb-4" />
              <CardTitle>Excellence</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-sm">
                Commitment to quality in every aspect of our platform and service.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Platform Features */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Why Choose Affilova?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Users className="w-10 h-10 text-blue-600 mb-2" />
                <CardTitle>Multi-Role Platform</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Seamlessly manage vendors, affiliates, and administrators in one unified platform with role-specific
                  dashboards and tools.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <TrendUp className="w-10 h-10 text-green-600 mb-2" />
                <CardTitle>Advanced Analytics</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Sales, commissions and product performance are listed in the vendor and affiliate dashboards.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Shield className="w-10 h-10 text-purple-600 mb-2" />
                <CardTitle>Secure Payments</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Payments run through our payment partner, and earnings are withdrawn from the dashboard to a saved
                  bank account.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Lightning className="w-10 h-10 text-orange-600 mb-2" />
                <CardTitle>Sales Pages</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Each product can carry its own sales page and thank-you page, so an affiliate sends buyers to the
                  vendor's own presentation of the product.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Target className="w-10 h-10 text-red-600 mb-2" />
                <CardTitle>Store Pages</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Every vendor gets a public store page at its own address, listing the products it sells on Affilova.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Medal className="w-10 h-10 text-indigo-600 mb-2" />
                <CardTitle>Product Review</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  A vendor submits a product for review, and it only appears in the marketplace once it has been
                  approved. Vendors can edit a product and resubmit it.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-brand-900 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Get Started?</h2>
          <p className="text-green-100 text-lg mb-8 max-w-2xl mx-auto">
            Whether you're a vendor looking to scale your business or an affiliate ready to earn, Affilova provides the
            tools and support you need to succeed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/sign-up">
              <Button size="lg" className="bg-white text-green-600 hover:bg-gray-100">
                Start as Vendor
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button
                size="lg"
                variant="outline"
                className="border-white text-white hover:bg-white hover:text-green-600"
              >
                Join as Affiliate
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-50 border-t py-8">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <Logo variant="horizontal" className="h-8 w-auto mb-4" />
              <p className="text-gray-600 text-sm">
                A marketplace where vendors list products and affiliates earn a commission on the sales they refer.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Platform</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link href="/sign-up" className="hover:text-gray-900">
                    Get Started
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="hover:text-gray-900">
                    About Us
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="hover:text-gray-900">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">For Vendors</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link href="/sign-up" className="hover:text-gray-900">
                    List Products
                  </Link>
                </li>
                <li>
                  <Link href="/how-it-works" className="hover:text-gray-900">
                    How It Works
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="hover:text-gray-900">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">For Affiliates</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link href="/sign-up" className="hover:text-gray-900">
                    Join as Affiliate
                  </Link>
                </li>
                <li>
                  <Link href="/how-it-works" className="hover:text-gray-900">
                    How It Works
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="hover:text-gray-900">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-8 pt-8 text-center text-sm text-gray-600">
            <p>
              {new Date().getFullYear()} Affilova. All rights reserved. Powered by{" "}
              <span className="font-semibold text-gray-900">Wisdom Technologies®</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
