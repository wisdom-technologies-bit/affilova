"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AlertCircle, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"

interface SalesPage {
  id: string
  product_id: string
  title: string
  content: string
  slug: string
}

export default function SalesPageBuilderPage() {
  const params = useParams()
  const productId = params.id as string
  const [salesPage, setSalesPage] = useState<SalesPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    title: "",
    content: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchSalesPage()
  }, [productId])

  const fetchSalesPage = async () => {
    try {
      const response = await fetch(`/api/products/${productId}/sales-page`)
      if (response.ok) {
        const data = await response.json()
        setSalesPage(data.salesPage)
        setFormData({
          title: data.salesPage.title || "",
          content: data.salesPage.content || "",
        })
      } else if (response.status === 404) {
        // New sales page
        setSalesPage(null)
      }
    } catch (err) {
      setError("Failed to load sales page")
      console.error("Error fetching sales page:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setError("")

    if (!formData.title) {
      setError("Page title is required")
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/products/${productId}/sales-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title,
          content: formData.content,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save sales page")
      }

      setSalesPage(data.salesPage)
      toast({
        title: "Sales Page Saved",
        description: "Your sales page has been created successfully",
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save sales page"
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
            <h1 className="text-3xl font-bold text-gray-900">Create Sales Page</h1>
            <p className="text-gray-600 mt-1">Design your product sales page with a simple text editor</p>
          </div>
        </div>

        {/* Sales Page Editor */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Page Builder</CardTitle>
            <CardDescription>
              Create an engaging sales page for your product. Use HTML formatting for advanced styling.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div>
              <Label htmlFor="title">Page Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
                placeholder="Enter your sales page title"
                className="mt-2"
              />
              <p className="text-xs text-gray-500 mt-1">This will be displayed as the page heading</p>
            </div>

            <div>
              <Label htmlFor="content">Page Content</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => handleInputChange("content", e.target.value)}
                placeholder="Enter your sales page content. You can use basic HTML tags for formatting."
                rows={15}
                className="mt-2 font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                Supports HTML formatting: &lt;p&gt;, &lt;h2&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;ul&gt;, &lt;li&gt;,
                &lt;a&gt;, &lt;img&gt;
              </p>
            </div>

            <div className="flex gap-2">
              <Link href="/dashboard/vendor/products" className="flex-1">
                <Button variant="outline" className="w-full bg-transparent">
                  Cancel
                </Button>
              </Link>
              <Button onClick={handleSave} className="flex-1 bg-green-600 hover:bg-green-700" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Sales Page
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {formData.content && (
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>How your sales page will look to customers</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg p-6 bg-white">
                <h2 className="text-2xl font-bold mb-4">{formData.title || "Your Sales Page"}</h2>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: formData.content }} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
