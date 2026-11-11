"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, CheckCircle, Mail, Phone, MapPin, Clock, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Logo } from "@/components/brand/logo"

export default function ContactPage() {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    category: "",
    message: "",
    priority: "medium",
  })
  const { toast } = useToast()

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit ticket")
      }

      setSuccess(true)
      setFormData({
        name: "",
        email: "",
        subject: "",
        category: "",
        message: "",
        priority: "medium",
      })

      toast({
        title: "Ticket Submitted",
        description: `Your support ticket #${data.ticketId} has been created. We'll respond within 24 hours.`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit ticket",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center space-x-3">
            <Logo variant="horizontal" className="h-10 w-auto" />
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

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Header Section */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Contact Us</h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Have questions or need support? We're here to help. Reach out to us and we'll respond as soon as possible.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Contact Information */}
            <div className="lg:col-span-1 space-y-6">
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-green-600" />
                    Get in Touch
                  </CardTitle>
                  <CardDescription>Multiple ways to reach our support team</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-gray-400 mt-1" />
                    <div>
                      <p className="font-semibold">Email Support</p>
                      <p className="text-gray-600 text-sm">support@affilova.com</p>
                      <p className="text-gray-500 text-xs">Response within 24 hours</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-gray-400 mt-1" />
                    <div>
                      <p className="font-semibold">Phone Support</p>
                      <p className="text-gray-600 text-sm">+234 800 AFFILOVA</p>
                      <p className="text-gray-500 text-xs">Mon-Fri, 9AM-6PM WAT</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-gray-400 mt-1" />
                    <div>
                      <p className="font-semibold">Office Address</p>
                      <p className="text-gray-600 text-sm">
                        Lagos, Nigeria
                        <br />
                        West Africa
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-gray-400 mt-1" />
                    <div>
                      <p className="font-semibold">Business Hours</p>
                      <p className="text-gray-600 text-sm">
                        Monday - Friday: 9:00 AM - 6:00 PM
                        <br />
                        Saturday: 10:00 AM - 4:00 PM
                        <br />
                        Sunday: Closed
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-lg bg-green-50">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-green-800 mb-2">Quick Help</h3>
                  <p className="text-green-700 text-sm mb-4">
                    Looking for immediate answers? Check out our FAQ section or browse our help documentation.
                  </p>
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      📚 Help Documentation
                    </Button>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      ❓ Frequently Asked Questions
                    </Button>
                    <Button variant="outline" className="w-full justify-start" size="sm">
                      🎥 Video Tutorials
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Send us a Message</CardTitle>
                  <CardDescription>
                    Fill out the form below and we'll get back to you as soon as possible
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {success ? (
                    <div className="text-center py-12">
                      <div className="flex justify-center mb-6">
                        <div className="bg-green-100 p-4 rounded-full">
                          <CheckCircle className="w-12 h-12 text-green-600" />
                        </div>
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-4">Message Sent!</h3>
                      <p className="text-gray-600 mb-6">
                        Thank you for contacting us. We've received your message and will respond within 24 hours.
                      </p>
                      <Button onClick={() => setSuccess(false)} variant="outline">
                        Send Another Message
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="name">Full Name *</Label>
                          <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleInputChange("name", e.target.value)}
                            placeholder="Your full name"
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="email">Email Address *</Label>
                          <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => handleInputChange("email", e.target.value)}
                            placeholder="your.email@example.com"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="category">Category *</Label>
                          <Select onValueChange={(value) => handleInputChange("category", value)} required>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">General Inquiry</SelectItem>
                              <SelectItem value="technical">Technical Support</SelectItem>
                              <SelectItem value="billing">Billing & Payments</SelectItem>
                              <SelectItem value="account">Account Issues</SelectItem>
                              <SelectItem value="partnership">Partnership</SelectItem>
                              <SelectItem value="bug">Bug Report</SelectItem>
                              <SelectItem value="feature">Feature Request</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="priority">Priority</Label>
                          <Select
                            value={formData.priority}
                            onValueChange={(value) => handleInputChange("priority", value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="subject">Subject *</Label>
                        <Input
                          id="subject"
                          value={formData.subject}
                          onChange={(e) => handleInputChange("subject", e.target.value)}
                          placeholder="Brief description of your inquiry"
                          required
                        />
                      </div>

                      <div>
                        <Label htmlFor="message">Message *</Label>
                        <Textarea
                          id="message"
                          value={formData.message}
                          onChange={(e) => handleInputChange("message", e.target.value)}
                          placeholder="Please provide as much detail as possible about your inquiry..."
                          rows={6}
                          required
                        />
                      </div>

                      <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-blue-800 font-semibold text-sm">Response Time</p>
                            <p className="text-blue-700 text-sm">
                              We typically respond to all inquiries within 24 hours during business days. Urgent issues
                              are prioritized and may receive faster responses.
                            </p>
                          </div>
                        </div>
                      </div>

                      <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Send Message
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mt-16">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
                <CardDescription>Quick answers to common questions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-2">How do I get started as an affiliate?</h4>
                    <p className="text-gray-600 text-sm mb-4">
                      Simply register for a free account, complete the onboarding process, and start applying to promote
                      products that match your audience.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">When do I get paid?</h4>
                    <p className="text-gray-600 text-sm mb-4">
                      All payments are processed every Thursday. You'll receive your earnings via bank transfer to your
                      registered account.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">How do I list my products as a vendor?</h4>
                    <p className="text-gray-600 text-sm mb-4">
                      Register as a vendor, complete your profile, and submit your products for approval. Once approved,
                      affiliates can start promoting them.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">What commission rates can I expect?</h4>
                    <p className="text-gray-600 text-sm mb-4">
                      Commission rates vary by product and vendor, typically ranging from 20% to 50%. Each product
                      listing shows the exact commission rate.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-50 border-t py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-gray-600">
            Powered by <span className="font-semibold text-gray-900">Wisdom Technologies®</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
