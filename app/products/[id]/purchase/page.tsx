"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, ArrowLeft, ShoppingCart } from "lucide-react"
import { SquadPayment } from "@/components/squad-payment"
import Link from "next/link"

interface Product {
  id: string
  title: string
  description: string
  price: number
  commission_rate: number
  image_url: string
  vendor_name: string
  vendor_company: string
}

export default function ProductPurchasePage() {
  const params = useParams()
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [customerInfo, setCustomerInfo] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
  })
  const [showPayment, setShowPayment] = useState(false)

  useEffect(() => {
    fetchProduct()
  }, [params.id])

  const fetchProduct = async () => {
    try {
      const response = await fetch(`/api/products/${params.id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch product")
      }

      setProduct(data.product)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load product")
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setCustomerInfo((prev) => ({ ...prev, [field]: value }))
  }

  const handleProceedToPayment = () => {
    if (!customerInfo.email || !customerInfo.firstName || !customerInfo.lastName) {
      setError("Please fill in all required fields")
      return
    }
    setError("")
    setShowPayment(true)
  }

  const handlePaymentSuccess = async (reference: string) => {
    try {
      // Verify payment and create transaction
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: product?.id,
          customerInfo,
          paymentReference: reference,
          affiliateCode: new URLSearchParams(window.location.search).get("ref"), // Get affiliate code from URL
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Transaction creation failed")
      }

      // Redirect to success page
      router.push(`/purchase/success?ref=${reference}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction processing failed")
      setShowPayment(false)
    }
  }

  const handlePaymentError = (error: string) => {
    setError(error)
    setShowPayment(false)
  }

  const handlePaymentClose = () => {
    setShowPayment(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p>Loading product...</p>
        </div>
      </div>
    )
  }

  if (error && !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Error Loading Product</h3>
            <p className="text-gray-600 mb-4">{error}</p>
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
        <div className="container mx-auto px-4 py-4 flex items-center space-x-4">
          <Link href={`/products/${params.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Product
            </Button>
          </Link>
          <div className="flex items-center space-x-3">
            <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto" />
            <div className="border-l pl-3">
              <h1 className="text-xl font-semibold text-gray-900">Secure Checkout</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto grid lg:grid-cols-2 gap-8">
          {/* Product Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {product && (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <img
                      src={product.image_url || "/placeholder.svg?height=80&width=80"}
                      alt={product.title}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold">{product.title}</h3>
                      <p className="text-sm text-gray-600">by {product.vendor_company || product.vendor_name}</p>
                      <Badge variant="secondary" className="mt-1">
                        Digital Product
                      </Badge>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Total</span>
                      <span>₦{product.price.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer Information & Payment */}
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
              <CardDescription>Enter your details to complete the purchase</CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md mb-4">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {!showPayment ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleProceedToPayment()
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name *</Label>
                      <Input
                        id="firstName"
                        value={customerInfo.firstName}
                        onChange={(e) => handleInputChange("firstName", e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name *</Label>
                      <Input
                        id="lastName"
                        value={customerInfo.lastName}
                        onChange={(e) => handleInputChange("lastName", e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="email">Email Address *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={customerInfo.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={customerInfo.phone}
                      onChange={(e) => handleInputChange("phone", e.target.value)}
                      placeholder="+234 800 000 0000"
                    />
                  </div>

                  <Button type="submit" className="w-full bg-green-600 hover:bg-green-700">
                    Proceed to Payment
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-2">Ready to Pay</h4>
                    <p className="text-sm text-green-700">
                      Click the button below to complete your payment securely with Squad.
                    </p>
                  </div>

                  <SquadPayment
                    email={customerInfo.email}
                    amount={product?.price || 0}
                    onSuccess={handlePaymentSuccess}
                    onError={handlePaymentError}
                    onClose={handlePaymentClose}
                    metadata={{
                      product_id: product?.id,
                      customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`,
                      customer_phone: customerInfo.phone,
                    }}
                  />

                  <Button type="button" variant="outline" className="w-full" onClick={() => setShowPayment(false)}>
                    Back to Customer Info
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
