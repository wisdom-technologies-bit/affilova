"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Download, ExternalLink, Mail, AlertCircle } from "lucide-react"
import Link from "next/link"

interface PurchaseDetails {
  id: string
  product_title: string
  product_type: "digital" | "physical"
  amount: number
  customer_name: string
  customer_email: string
  receipt_number: string
  receipt_url?: string
  product_access_info?: string
  thank_you_page_url?: string
  vendor_contact?: string
  created_at: string
}

export default function PurchaseSuccessPage() {
  const searchParams = useSearchParams()
  const [purchase, setPurchase] = useState<PurchaseDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [accessViewed, setAccessViewed] = useState(false)

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref) {
      fetchPurchaseDetails(ref)
    } else {
      setError("Invalid purchase reference")
      setLoading(false)
    }
  }, [searchParams])

  const fetchPurchaseDetails = async (reference: string) => {
    try {
      const response = await fetch(`/api/purchase/details?ref=${reference}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch purchase details")
      }

      setPurchase(data.purchase)

      // Mark access as viewed (can only be viewed once)
      if (!accessViewed) {
        await fetch(`/api/purchase/mark-viewed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reference }),
        })
        setAccessViewed(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase details")
    } finally {
      setLoading(false)
    }
  }

  const downloadReceipt = () => {
    if (purchase?.receipt_url) {
      window.open(purchase.receipt_url, "_blank")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p>Loading purchase details...</p>
        </div>
      </div>
    )
  }

  if (error || !purchase) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Purchase Not Found</h3>
            <p className="text-gray-600 mb-4">{error || "This purchase reference is invalid or has expired."}</p>
            <Link href="/">
              <Button>Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-center">
          <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto" />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Success Message */}
          <Card className="mb-8">
            <CardContent className="p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="bg-green-100 p-4 rounded-full">
                  <CheckCircle className="w-12 h-12 text-green-600" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">Payment Successful!</h1>
              <p className="text-gray-600 text-lg mb-6">
                Thank you for your purchase, {purchase.customer_name}. Your order has been confirmed.
              </p>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-green-800 font-semibold">Receipt Number: {purchase.receipt_number}</p>
                <p className="text-green-700 text-sm mt-1">
                  A confirmation email has been sent to {purchase.customer_email}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Purchase Details */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Purchase Details
              </CardTitle>
              <CardDescription>Your order information and receipt</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Product</label>
                  <p className="font-semibold">{purchase.product_title}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Amount Paid</label>
                  <p className="font-semibold">₦{(purchase.amount / 100).toLocaleString()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Purchase Date</label>
                  <p className="font-semibold">{new Date(purchase.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Product Type</label>
                  <Badge variant={purchase.product_type === "digital" ? "default" : "secondary"}>
                    {purchase.product_type === "digital" ? "Digital Product" : "Physical Product"}
                  </Badge>
                </div>
              </div>

              {purchase.receipt_url && (
                <div className="pt-4 border-t">
                  <Button onClick={downloadReceipt} className="w-full" variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    Download Receipt
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product Access Information */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {purchase.product_type === "digital" ? (
                  <Download className="w-5 h-5" />
                ) : (
                  <ExternalLink className="w-5 h-5" />
                )}
                {purchase.product_type === "digital" ? "Access Your Product" : "Delivery Information"}
              </CardTitle>
              <CardDescription>
                {purchase.product_type === "digital"
                  ? "Download links and access information"
                  : "Information about receiving your physical product"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {purchase.product_type === "digital" ? (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-blue-800 mb-2">Digital Product Access</h4>
                    <p className="text-blue-700 text-sm mb-3">
                      Your digital product is ready for download. This access information is only shown once for
                      security.
                    </p>
                    {purchase.product_access_info && (
                      <div className="bg-white p-3 rounded border">
                        <pre className="text-sm whitespace-pre-wrap">{purchase.product_access_info}</pre>
                      </div>
                    )}
                  </div>

                  {purchase.thank_you_page_url && (
                    <Button asChild className="w-full">
                      <Link href={purchase.thank_you_page_url} target="_blank">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Access Product Page
                      </Link>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-orange-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-orange-800 mb-2">Physical Product Delivery</h4>
                    <p className="text-orange-700 text-sm mb-3">
                      This is a physical product. Please follow the instructions below to receive your item.
                    </p>
                    {purchase.product_access_info && (
                      <div className="bg-white p-3 rounded border">
                        <pre className="text-sm whitespace-pre-wrap">{purchase.product_access_info}</pre>
                      </div>
                    )}
                  </div>

                  {purchase.vendor_contact && (
                    <div className="bg-gray-50 p-3 rounded">
                      <p className="text-sm">
                        <strong>Vendor Contact:</strong> {purchase.vendor_contact}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Important Notice */}
          <Card className="mb-8">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-800 mb-2">Important Notice</h4>
                  <ul className="text-amber-700 text-sm space-y-1">
                    <li>• This page can only be accessed once for security reasons</li>
                    <li>• Save or screenshot any important information you need</li>
                    <li>• Check your email for a copy of all purchase details</li>
                    <li>• Contact support if you have any issues accessing your product</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="text-center space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/">
                <Button variant="outline" className="w-full sm:w-auto">
                  Continue Shopping
                </Button>
              </Link>
              <Link href="/contact">
                <Button variant="outline" className="w-full sm:w-auto">
                  Contact Support
                </Button>
              </Link>
            </div>

            <p className="text-sm text-gray-600">Need help? Contact us at support@affilova.com</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-50 border-t py-8 mt-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-gray-600">
            Powered by <span className="font-semibold text-gray-900">Wisdom Technologies®</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
