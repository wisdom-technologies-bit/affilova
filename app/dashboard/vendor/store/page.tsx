"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AlertCircle, Loader2, Copy, Check, Zap } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { SquadPayment } from "@/components/squad-payment"

interface StoreSettings {
  store_slug: string
  store_name: string
  store_url: string
  can_change_for_free: boolean
}

export default function VendorStoreSettingsPage() {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [slugCheckLoading, setSlugCheckLoading] = useState(false)
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [suggestedSlugs, setSuggestedSlugs] = useState<string[]>([])
  const [showPayment, setShowPayment] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<{ name: string; slug: string } | null>(null)
  const [formData, setFormData] = useState({
    storeSlug: "",
    storeName: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    fetchStoreSettings()
  }, [])

  const fetchStoreSettings = async () => {
    try {
      const response = await fetch("/api/vendor/store-settings")
      if (response.ok) {
        const data = await response.json()
        setStoreSettings(data.store)
        setFormData({
          storeSlug: data.store.store_slug || "",
          storeName: data.store.store_name || "",
        })
      }
    } catch (err) {
      setError("Failed to load store settings")
      console.error("Error fetching store settings:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (field === "storeSlug") {
      checkSlugAvailability(value)
    }
  }

  const validateSlug = (slug: string): boolean => {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    return slugRegex.test(slug) && slug.length >= 3 && slug.length <= 50
  }

  const checkSlugAvailability = async (slug: string) => {
    if (!slug || !validateSlug(slug)) {
      setSlugAvailable(null)
      setSuggestedSlugs([])
      return
    }

    setSlugCheckLoading(true)
    try {
      const response = await fetch(`/api/vendor/check-slug?slug=${encodeURIComponent(slug)}`)
      const data = await response.json()

      setSlugAvailable(data.available)
      if (!data.available && data.suggestions) {
        setSuggestedSlugs(data.suggestions)
      } else {
        setSuggestedSlugs([])
      }
    } catch (err) {
      console.error("Error checking slug:", err)
      setSlugAvailable(null)
    } finally {
      setSlugCheckLoading(false)
    }
  }

  const handleSaveFree = async () => {
    setError("")

    if (!formData.storeSlug || !formData.storeName) {
      setError("All fields are required")
      return
    }

    if (!validateSlug(formData.storeSlug)) {
      setError("Store slug must be 3-50 characters, lowercase, numbers, and hyphens only")
      return
    }

    if (!slugAvailable) {
      setError("This store slug is already taken. Please choose another.")
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/vendor/store-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeSlug: formData.storeSlug,
          storeName: formData.storeName,
          paymentRequired: false,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save store settings")
      }

      setStoreSettings(data.store)
      toast({
        title: "Store Settings Saved",
        description: "Your store settings have been updated successfully",
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save store settings"
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

  const handleInitiatePaidChange = () => {
    setPendingChanges({ name: formData.storeName, slug: formData.storeSlug })
    setShowPayment(true)
  }

  const handlePaymentSuccess = async (reference: string) => {
    if (!pendingChanges) return

    setSaving(true)
    try {
      const response = await fetch("/api/vendor/store-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeSlug: pendingChanges.slug,
          storeName: pendingChanges.name,
          paymentRequired: true,
          paymentReference: reference,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to save store settings")
      }

      setStoreSettings(data.store)
      setShowPayment(false)
      setPendingChanges(null)
      toast({
        title: "Store Settings Updated",
        description: "Your store has been successfully updated",
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save store settings"
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

  const copyToClipboard = () => {
    if (storeSettings?.store_url) {
      navigator.clipboard.writeText(storeSettings.store_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: "Copied",
        description: "Store URL copied to clipboard",
      })
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

  if (showPayment) {
    return (
      <DashboardLayout role="vendor">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Confirm Store Changes</h1>
            <p className="text-gray-600 mt-1">
              A ₦500 fee applies to change your store name or URL after the first setup
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Payment Required</CardTitle>
              <CardDescription>Complete the payment to apply your store changes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>New Store Name:</strong> {pendingChanges?.name}
                </p>
                <p className="text-sm text-blue-900 mt-2">
                  <strong>New Store Slug:</strong> {pendingChanges?.slug}
                </p>
              </div>

              <SquadPayment
                amount={50000} // 500 naira in kobo
                email=""
                metadata={{
                  type: "store_change",
                  storeName: pendingChanges?.name,
                  storeSlug: pendingChanges?.slug,
                }}
                onSuccess={handlePaymentSuccess}
                onError={(error) => {
                  setError(error)
                  setShowPayment(false)
                }}
                onClose={() => setShowPayment(false)}
                loading={false}
              />
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="vendor">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Store Settings</h1>
          <p className="text-gray-600 mt-1">
            Configure your vendor store information and customize your public storefront
          </p>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div>
            <Label htmlFor="storeName" className="text-base font-semibold">
              Store Name
            </Label>
            <Input
              id="storeName"
              value={formData.storeName}
              onChange={(e) => handleInputChange("storeName", e.target.value)}
              placeholder="Your Store Name"
              className="mt-2"
            />
            <p className="text-xs text-gray-500 mt-1">The name displayed to your customers</p>
          </div>

          <div>
            <Label htmlFor="storeSlug" className="text-base font-semibold">
              Store URL Slug
            </Label>
            <div className="flex gap-2 mt-2">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-mono">yourdomain.com/store/</span>
                  {slugCheckLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {!slugCheckLoading && slugAvailable === true && <Check className="w-4 h-4 text-green-600" />}
                  {!slugCheckLoading && slugAvailable === false && <AlertCircle className="w-4 h-4 text-red-600" />}
                </div>
                <Input
                  id="storeSlug"
                  value={formData.storeSlug}
                  onChange={(e) => handleInputChange("storeSlug", e.target.value.toLowerCase())}
                  placeholder="my-store"
                  className="font-mono"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">3-50 characters, lowercase letters, numbers, and hyphens only</p>

            {suggestedSlugs.length > 0 && (
              <div className="mt-3 p-3 bg-amber-50 rounded-lg">
                <p className="text-xs font-medium text-amber-900 mb-2">This slug is taken. Try one of these:</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedSlugs.map((slug) => (
                    <Button
                      key={slug}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs bg-transparent"
                      onClick={() => handleInputChange("storeSlug", slug)}
                    >
                      {slug}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {storeSettings?.store_url && (
            <div>
              <Label className="text-base font-semibold">Your Store URL</Label>
              <div className="flex gap-2 mt-2">
                <Input readOnly value={storeSettings.store_url} className="bg-gray-50 font-mono text-sm" />
                <Button variant="outline" size="sm" onClick={copyToClipboard} className="flex-shrink-0 bg-transparent">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          )}

          {storeSettings?.can_change_for_free ? (
            <Button onClick={handleSaveFree} className="bg-green-600 hover:bg-green-700 w-full" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Store Settings (Free)
            </Button>
          ) : (
            <Button
              onClick={handleInitiatePaidChange}
              className="bg-green-600 hover:bg-green-700 w-full"
              disabled={saving || !slugAvailable}
            >
              <Zap className="w-4 h-4 mr-2" />
              Update Store (₦500 Fee)
            </Button>
          )}
        </div>

        <div className="pt-8 border-t">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Your Public Store</h2>
          <p className="text-gray-600 mb-6">All your products are publicly accessible on your store page</p>
          {storeSettings?.store_url && (
            <Button
              variant="default"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => window.open(storeSettings.store_url, "_blank")}
            >
              View Public Store →
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
