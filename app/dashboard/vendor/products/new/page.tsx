"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertCircle, Upload, X, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function NewProductPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [activeTab, setActiveTab] = useState("basic")

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    price: "",
    commissionRate: "",
    category: "",
    imageUrl: "",
    salesPageHtml: "",
    thankYouPageType: "template",
    thankYouPageCustomUrl: "",
    thankYouPageProductFile: null as File | null,
  })

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingImage(true)
    try {
      const formDataObj = new FormData()
      formDataObj.append("file", file)
      formDataObj.append("folder", "products")
      formDataObj.append("resourceType", "image")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formDataObj,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Upload failed")
      }

      handleInputChange("imageUrl", data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingImage(false)
    }
  }

  const handleProductFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData((prev) => ({ ...prev, thankYouPageProductFile: file }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.title || !formData.description || !formData.price || !formData.category || !formData.imageUrl) {
      setError("Please fill in all required fields")
      return
    }

    if (formData.thankYouPageType === "custom_url" && !formData.thankYouPageCustomUrl) {
      setError("Please provide a custom thank you page URL")
      return
    }

    if (formData.thankYouPageType === "template" && !formData.thankYouPageProductFile) {
      setError("Please upload the product file for the thank you page")
      return
    }

    setLoading(true)

    try {
      let productFileUrl = ""

      if (formData.thankYouPageProductFile) {
        const fileFormData = new FormData()
        fileFormData.append("file", formData.thankYouPageProductFile)
        fileFormData.append("folder", "product-files")
        fileFormData.append("resourceType", "auto")

        const uploadResponse = await fetch("/api/upload", {
          method: "POST",
          body: fileFormData,
        })

        const uploadData = await uploadResponse.json()

        if (!uploadResponse.ok) {
          throw new Error(uploadData.error || "File upload failed")
        }

        productFileUrl = uploadData.url
      }

      const response = await fetch("/api/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          price: Number.parseFloat(formData.price),
          commissionRate: Number.parseFloat(formData.commissionRate),
          category: formData.category,
          imageUrl: formData.imageUrl,
          salesPageHtml: formData.salesPageHtml,
          thankYouPageType: formData.thankYouPageType,
          thankYouPageCustomUrl: formData.thankYouPageCustomUrl,
          thankYouPageProductFilePath: productFileUrl,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create product")
      }

      router.push("/dashboard/vendor/products")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex items-center space-x-4">
          <Link href="/dashboard/vendor">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <div className="flex items-center space-x-3">
            <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto" />
            <div className="border-l pl-3">
              <h1 className="text-xl font-semibold text-gray-900">Add New Product</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="basic">Product Info</TabsTrigger>
                <TabsTrigger value="sales">Sales Page</TabsTrigger>
                <TabsTrigger value="thankyou">Thank You Page</TabsTrigger>
              </TabsList>

              {/* Basic Product Information */}
              <TabsContent value="basic" className="space-y-6 mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Product Information</CardTitle>
                    <CardDescription>Add your product details to start attracting affiliates</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <Label htmlFor="title">Product Title *</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => handleInputChange("title", e.target.value)}
                        placeholder="Enter product title"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="description">Description *</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => handleInputChange("description", e.target.value)}
                        placeholder="Describe your product..."
                        rows={4}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="price">Price (₦) *</Label>
                        <Input
                          id="price"
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => handleInputChange("price", e.target.value)}
                          placeholder="0.00"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="commissionRate">Commission Rate (%)</Label>
                        <Input
                          id="commissionRate"
                          type="number"
                          step="0.01"
                          max="100"
                          value={formData.commissionRate}
                          onChange={(e) => handleInputChange("commissionRate", e.target.value)}
                          placeholder="40.00"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="category">Category *</Label>
                      <Select onValueChange={(value) => handleInputChange("category", value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="digital-products">Digital Products</SelectItem>
                          <SelectItem value="physical-products">Physical Products</SelectItem>
                          <SelectItem value="software">Software</SelectItem>
                          <SelectItem value="courses">Courses</SelectItem>
                          <SelectItem value="ebooks">E-books</SelectItem>
                          <SelectItem value="solar-products">Solar Products</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Product Image *</Label>
                      <div className="mt-2">
                        {formData.imageUrl ? (
                          <div className="relative">
                            <img
                              src={formData.imageUrl || "/placeholder.svg"}
                              alt="Product"
                              className="w-full h-48 object-cover rounded-lg"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="absolute top-2 right-2"
                              onClick={() => handleInputChange("imageUrl", "")}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-600 mb-2">Upload product image</p>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleImageUpload}
                              className="hidden"
                              id="image-upload"
                              disabled={uploadingImage}
                            />
                            <Label htmlFor="image-upload">
                              <Button type="button" variant="outline" disabled={uploadingImage} asChild>
                                <span>
                                  {uploadingImage && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                  Choose File
                                </span>
                              </Button>
                            </Label>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Sales Page */}
              <TabsContent value="sales" className="space-y-6 mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Sales Page</CardTitle>
                    <CardDescription>Create a custom sales page for your product using HTML</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="salesPageHtml">Sales Page HTML</Label>
                      <Textarea
                        id="salesPageHtml"
                        value={formData.salesPageHtml}
                        onChange={(e) => handleInputChange("salesPageHtml", e.target.value)}
                        placeholder={`<div class="container">
  <h1>Your Product Title</h1>
  <p>Your product description here</p>
  <button>Buy Now</button>
</div>`}
                        rows={12}
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        You can write custom HTML/CSS here. A drag and drop editor is available in your product settings for
                        editing later.
                      </p>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                      <p className="text-sm text-blue-900">
                        <strong>Pro Tip:</strong> Keep your sales page focused on benefits, social proof, and a clear
                        call-to-action. The product details from above will be automatically included.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Thank You Page */}
              <TabsContent value="thankyou" className="space-y-6 mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Thank You Page</CardTitle>
                    <CardDescription>Choose how customers access their purchase</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <Label>Thank You Page Type *</Label>
                      <Select
                        value={formData.thankYouPageType}
                        onValueChange={(value) => handleInputChange("thankYouPageType", value)}
                      >
                        <SelectTrigger className="mt-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="template">Use Affilova Template (Recommended)</SelectItem>
                          <SelectItem value="custom_url">Custom Thank You Page URL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.thankYouPageType === "template" && (
                      <div>
                        <Label htmlFor="productFile">Upload Product File *</Label>
                        <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <p className="text-sm text-gray-600 mb-2">
                            {formData.thankYouPageProductFile
                              ? formData.thankYouPageProductFile.name
                              : "Upload your digital product"}
                          </p>
                          <p className="text-xs text-gray-500 mb-3">Any file format supported (PDF, ZIP, MP4, etc.)</p>
                          <input type="file" id="productFile" onChange={handleProductFileUpload} className="hidden" />
                          <Label htmlFor="productFile">
                            <Button type="button" variant="outline" asChild>
                              <span>Choose File</span>
                            </Button>
                          </Label>
                        </div>
                        <div className="bg-green-50 border border-green-200 p-4 rounded-lg mt-4">
                          <p className="text-sm text-green-900">
                            Customers will receive a download link immediately after purchase using our template.
                          </p>
                        </div>
                      </div>
                    )}

                    {formData.thankYouPageType === "custom_url" && (
                      <div>
                        <Label htmlFor="customUrl">Thank You Page URL *</Label>
                        <Input
                          id="customUrl"
                          type="url"
                          value={formData.thankYouPageCustomUrl}
                          onChange={(e) => handleInputChange("thankYouPageCustomUrl", e.target.value)}
                          placeholder="https://example.com/thank-you"
                          className="mt-2"
                        />
                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg mt-4 space-y-2">
                          <p className="text-sm font-medium text-amber-900">Important Requirements:</p>
                          <ul className="text-sm text-amber-800 list-disc list-inside space-y-1">
                            <li>URL must be SSL/HTTPS certified</li>
                            <li>You must attach/provide the product download on this page</li>
                            <li>Customers will be redirected after payment</li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex gap-4">
              <Link href="/dashboard/vendor/products" className="flex-1">
                <Button type="button" variant="outline" className="w-full bg-transparent">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Product
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
