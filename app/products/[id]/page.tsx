"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, ShoppingCart, Star, Users, ExternalLink } from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/brand/logo"

interface Product {
  id: string
  alphanumeric_id: string
  title: string
  description: string
  price: number
  commission_rate: number
  category: string
  image_url: string
  sales_page_url: string
  vendor_name: string
  vendor_company: string
  created_at: string
}

export default function ProductPage() {
  const params = useParams()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchProduct()
  }, [params.id])

  const fetchProduct = async () => {
    try {
      const response = await fetch(`/api/products/${params.id}/public`)
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

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Product Not Found</h3>
            <p className="text-gray-600 mb-4">{error || "This product doesn't exist or has been removed."}</p>
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
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3">
            <Logo variant="horizontal" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center space-x-4">
            <Link href="/auth/login">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link href="/auth/register">
              <Button className="bg-green-600 hover:bg-green-700">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Product Image */}
            <div className="space-y-4">
              <div className="aspect-square rounded-lg overflow-hidden bg-white shadow-sm">
                <img
                  src={product.image_url || "/placeholder.svg?height=600&width=600"}
                  alt={product.title}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Product Details */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary">{product.category}</Badge>
                  <Badge className="bg-green-100 text-green-800">{product.commission_rate}% Affiliate Commission</Badge>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-4">{product.title}</h1>
                <p className="text-gray-600 text-lg leading-relaxed">{product.description}</p>
              </div>

              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-3xl font-bold text-gray-900">₦{product.price.toLocaleString()}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Sold by</p>
                    <p className="font-semibold">{product.vendor_company || product.vendor_name}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Link href={`/products/${product.alphanumeric_id}/purchase`}>
                    <Button className="w-full bg-green-600 hover:bg-green-700 text-lg py-6">
                      <ShoppingCart className="w-5 h-5 mr-2" />
                      Buy Now - ₦{product.price.toLocaleString()}
                    </Button>
                  </Link>

                  {product.sales_page_url && (
                    <Link href={product.sales_page_url} target="_blank">
                      <Button variant="outline" className="w-full">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View Sales Page
                      </Button>
                    </Link>
                  )}
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="font-semibold text-lg mb-4">Product Features</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-yellow-500" />
                    <span className="text-sm">High Quality</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-500" />
                    <span className="text-sm">Trusted Vendor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-green-500" />
                    <span className="text-sm">Secure Payment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ExternalLink className="w-5 h-5 text-purple-500" />
                    <span className="text-sm">Instant Access</span>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="font-semibold text-green-800 mb-2">Affiliate Program Available</h4>
                <p className="text-green-700 text-sm">
                  Earn {product.commission_rate}% commission by promoting this product.
                  <Link href="/auth/register" className="underline ml-1">
                    Join as an affiliate
                  </Link>
                </p>
              </div>
            </div>
          </div>

          {/* Additional Product Information */}
          <div className="mt-12">
            <Card>
              <CardHeader>
                <CardTitle>About This Product</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  <p className="text-gray-600 leading-relaxed">{product.description}</p>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <h4 className="font-semibold mb-2">Category</h4>
                      <p className="text-gray-600">{product.category}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Vendor</h4>
                      <p className="text-gray-600">{product.vendor_company || product.vendor_name}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold mb-2">Listed</h4>
                      <p className="text-gray-600">{new Date(product.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-50 border-t py-8 mt-12">
        <div className="container mx-auto px-4 text-center">
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-4">
            <Link href="/about" className="text-gray-600 hover:text-gray-900">
              About
            </Link>
            <Link href="/contact" className="text-gray-600 hover:text-gray-900">
              Contact
            </Link>
            <Link href="/auth/register" className="text-green-600 hover:text-green-700">
              Become an Affiliate
            </Link>
          </div>
          <p className="text-sm text-gray-600">
            Powered by <span className="font-semibold text-gray-900">Wisdom Technologies®</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
