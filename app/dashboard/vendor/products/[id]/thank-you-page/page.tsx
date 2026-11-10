"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AlertCircle, Loader2, ArrowLeft, Upload } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"

interface ThankYouPage {
  id: string
  product_id: string
  type: "template" | "custom_url"
  custom_url?: string
  product_file_url?: string
}

export default function ThankYouPagePage() {
  const params = useParams()
  const productId = params.id as string
  const [thankYouPage, setThankYouPage] = useState<ThankYouPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [selectedTab, setSelectedTab] = useState("template")
  const [uploading, setUploading] = useState(false)
  const [formData, setFormData] = useState({
    type: "template",
    customUrl: "",
    productFile: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchThankYouPage()
  }, [productId])

  const fetchThankYouPage = async () => {
    try {
      const response = await fetch(`/api/products/${productId}/thank-you-page`)
      if (response.ok) {
        const data = await response.json()
        setThankYouPage(data.thankYouPage)
        setSelectedTab(data.thankYouPage.type)
        setFormData({
          type: data.thankYouPage.type,
          customUrl: data.thankYouPage.custom_url || "",
          productFile: data.thankYouPage.product_file_url || "",
        })
      }
    } catch (err) {
      setError("Failed to load thank you page settings")
      console.error("Error fetching thank you page:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formDataToSend = new FormData()
      formDataToSend.append("file", file)
      formDataToSend.append("folder", "products")
      formDataToSend.append("resourceType", "file")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formDataToSend,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Upload failed")
      }

      setFormData((prev) => ({ ...prev, productFile: data.url }))
      toast({
        title: "File Uploaded",
        description: "Your product file has been uploaded successfully",
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed"
      setError(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    setError("")

    if (selectedTab === "custom_url") {
      if (!formData.customUrl) {
        setError("Custom URL is required")
        return
      }

      try {
        new URL(formData.customUrl)
      } catch {
        setError("Please enter a valid URL")
        return
      }

      if (!formData.customUrl.startsWith("https://")) {
        setError("URL must use HTTPS (SSL) protocol")
        return
      }
    } else if (selectedTab === "template") {
      if (!formData.productFile) {
        setError("Please upload your product file for the template thank you page")
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/products/${productId}/thank-you-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: selectedTab,
          customUrl: formData.customUrl || undefined,
          productFileUrl: formData.productFile || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save thank you page settings")
      }

      setThankYouPage(data.thankYouPage)
      toast({
        title: "Thank You Page Configured",
        description: "Your thank you page settings have been saved successfully",
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save thank you page"
      setError(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout role="vendor">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="vendor">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Link href="/dashboard/vendor/products">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Thank You Page Settings</h1>
            <p className="text-gray-600 mt-1">Configure how customers access their purchased product</p>
          </div>
        </div>

        {/* Thank You Page Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Choose Thank You Page Type</CardTitle>
            <CardDescription>
              Select how you want to deliver the product to your customers after purchase
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-6 flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="template">Our Template</TabsTrigger>
                <TabsTrigger value="custom_url">Custom URL</TabsTrigger>
              </TabsList>

              <TabsContent value="template" className="space-y-4 mt-6">
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                  <h3 className="font-semibold text-blue-900 mb-2">Template Thank You Page</h3>
                  <p className="text-sm text-blue-800 mb-4">
                    Use our built-in template where customers can download or access their purchased product directly.
                    The product file will be available for download immediately after purchase.
                  </p>
                  <p className="text-sm text-blue-700">
                    <strong>How it works:</strong> After purchase, customers see a thank you page where they can
                    download the file or access it directly.
                  </p>
                </div>

                <div>
                  <Label htmlFor="productFile">Upload Product File</Label>
                  <div className="mt-2">
                    {formData.productFile ? (
                      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-green-900">File uploaded successfully</p>
                          <p className="text-xs text-green-700">{formData.productFile.split("/").pop()}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormData((prev) => ({ ...prev, productFile: "" }))}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-2">Upload your product file</p>
                        <input
                          type="file"
                          onChange={handleFileUpload}
                          className="hidden"
                          id="product-file-upload"
                          disabled={uploading}
                        />
                        <Label htmlFor="product-file-upload">
                          <Button type="button" variant="outline" disabled={uploading} asChild>
                            <span>{uploading ? "Uploading..." : "Choose File"}</span>
                          </Button>
                        </Label>
                        <p className="text-xs text-gray-500 mt-2">Any file format (ZIP, PDF, EXE, etc.)</p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="custom_url" className="space-y-4 mt-6">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
                  <h3 className="font-semibold text-amber-900 mb-2">Custom Thank You Page URL</h3>
                  <p className="text-sm text-amber-800 mb-3">
                    Redirect customers to your own thank you page. Make sure your page is secured with SSL (HTTPS).
                  </p>
                  <p className="text-sm text-amber-700 mb-3">
                    <strong>Important:</strong> You must attach/upload the product file on your thank you page before
                    submitting. Customers should be able to access or download the product from that page.
                  </p>
                  <p className="text-xs text-amber-600">We require HTTPS (SSL) certification for security purposes.</p>
                </div>

                <div>
                  <Label htmlFor="customUrl">Thank You Page URL</Label>
                  <Input
                    id="customUrl"
                    type="url"
                    value={formData.customUrl}
                    onChange={(e) => setFormData((prev) => ({ ...prev, customUrl: e.target.value }))}
                    placeholder="https://yourdomain.com/thank-you"
                    className="mt-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">Must start with HTTPS:// and be SSL certified</p>
                </div>

                <Card className="bg-gray-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Requirements Checklist</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" disabled className="mt-1" />
                      <span>Your thank you page uses HTTPS (SSL certified)</span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" disabled className="mt-1" />
                      <span>Product file is attached/available on the thank you page</span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" disabled className="mt-1" />
                      <span>Page is accessible and working properly</span>
                    </label>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex gap-2 mt-6">
              <Link href="/dashboard/vendor/products" className="flex-1">
                <Button variant="outline" className="w-full bg-transparent">
                  Cancel
                </Button>
              </Link>
              <Button onClick={handleSave} className="flex-1 bg-green-600 hover:bg-green-700" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
