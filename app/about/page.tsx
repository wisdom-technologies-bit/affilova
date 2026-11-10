import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, TrendingUp, Shield, Zap, Target, Award, Globe, Heart } from "lucide-react"

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-3">
            <img src="/affilova-logo.png" alt="Affilova" className="h-10 w-auto" />
          </Link>
          <div className="flex space-x-4">
            <Link href="/auth/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/auth/register">
              <Button className="bg-green-600 hover:bg-green-700">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 text-center">
        <Badge className="mb-4 bg-green-100 text-green-800 hover:bg-green-100">🚀 Empowering Digital Commerce</Badge>
        <h1 className="text-5xl font-bold text-gray-900 mb-6">About Affilova</h1>
        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
          We're building the future of affiliate marketing by connecting ambitious vendors with top-performing
          affiliates through cutting-edge technology and seamless user experiences.
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
                Founded by a team of experienced entrepreneurs and technologists, we set out to create a platform that
                would level the playing field. Our goal was to build something that would be powerful enough for
                enterprise vendors yet simple enough for individual affiliates just starting their journey.
              </p>
              <p>
                Today, Affilova serves thousands of vendors and affiliates worldwide, processing millions in
                transactions while maintaining our core values of transparency, fairness, and innovation.
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
              <Zap className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
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
              <Award className="w-12 h-12 text-purple-600 mx-auto mb-4" />
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
                <TrendingUp className="w-10 h-10 text-green-600 mb-2" />
                <CardTitle>Advanced Analytics</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Track performance, conversions, and commissions with real-time analytics, detailed reporting, and
                  actionable insights.
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
                  Integrated with Squad by Monnify for secure, automated payment processing and reliable weekly payouts.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Zap className="w-10 h-10 text-orange-600 mb-2" />
                <CardTitle>Marketing Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Built-in landing page builder, resource sharing, email automation, and comprehensive marketing assets
                  for maximum conversions.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Target className="w-10 h-10 text-red-600 mb-2" />
                <CardTitle>Smart Matching</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  AI-powered affiliate-product matching based on performance history, audience alignment, and conversion
                  potential.
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <Award className="w-10 h-10 text-indigo-600 mb-2" />
                <CardTitle>Quality Assurance</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">
                  Rigorous product approval process and affiliate verification to maintain high standards and protect
                  all parties.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Leadership Team</h2>
        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <Card className="text-center border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-white font-bold text-xl">WM</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Wisdom Meremeze</h3>
              <p className="text-green-600 font-semibold mb-2">Founder & CEO</p>
              <p className="text-gray-600 text-sm">
                Visionary leader with 10+ years in digital marketing and e-commerce, passionate about empowering
                entrepreneurs.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="w-24 h-24 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-white font-bold text-xl">AT</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Alex Thompson</h3>
              <p className="text-blue-600 font-semibold mb-2">CTO</p>
              <p className="text-gray-600 text-sm">
                Technology expert specializing in scalable platforms and secure payment systems for high-volume
                transactions.
              </p>
            </CardContent>
          </Card>

          <Card className="text-center border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="w-24 h-24 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-white font-bold text-xl">SJ</span>
              </div>
              <h3 className="font-bold text-lg mb-2">Sarah Johnson</h3>
              <p className="text-purple-600 font-semibold mb-2">Head of Operations</p>
              <p className="text-gray-600 text-sm">
                Operations specialist focused on user experience and building efficient processes for global
                scalability.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-green-600 to-green-700 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Join Our Community?</h2>
          <p className="text-green-100 text-lg mb-8 max-w-2xl mx-auto">
            Whether you're a vendor looking to scale your business or an affiliate ready to earn, Affilova provides the
            tools and support you need to succeed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/register?role=vendor">
              <Button size="lg" className="bg-white text-green-600 hover:bg-gray-100">
                Start as Vendor
              </Button>
            </Link>
            <Link href="/auth/register?role=affiliate">
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
              <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto mb-4" />
              <p className="text-gray-600 text-sm">
                The premier affiliate marketplace connecting vendors with top-performing affiliates.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Platform</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link href="/auth/register" className="hover:text-gray-900">
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
                  <Link href="/auth/register?role=vendor" className="hover:text-gray-900">
                    List Products
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-gray-900">
                    Find Affiliates
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-gray-900">
                    Analytics
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">For Affiliates</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>
                  <Link href="/auth/register?role=affiliate" className="hover:text-gray-900">
                    Join Network
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-gray-900">
                    Browse Products
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-gray-900">
                    Earn Commissions
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-8 pt-8 text-center text-sm text-gray-600">
            <p>
              © 2024 Affilova. All rights reserved. Powered by{" "}
              <span className="font-semibold text-gray-900">Wisdom Technologies®</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
