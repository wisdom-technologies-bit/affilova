"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, Loader2, User, Building, Camera, Upload, ArrowRight } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Logo } from "@/components/brand/logo"

interface VendorOnboardingData {
  firstName: string
  lastName: string
  companyName: string
  businessType: string
  websiteUrl: string
  description: string
  avatar: string
}

export default function VendorOnboardingPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<VendorOnboardingData>({
    firstName: "",
    lastName: "",
    companyName: "",
    businessType: "",
    websiteUrl: "",
    description: "",
    avatar: "",
  })

  useEffect(() => {
    checkAuthAndFetchData()
  }, [])

  const checkAuthAndFetchData = async () => {
    try {
      const response = await fetch("/api/auth/me")
      if (!response.ok) {
        router.push("/auth/login")
        return
      }

      const data = await response.json()
      if (data.user.role !== "vendor") {
        router.push("/dashboard/select-role")
        return
      }

      if (data.user.onboardingCompleted) {
        router.push("/dashboard/vendor")
        return
      }

      // Pre-fill with existing user data
      setFormData((prev) => ({
        ...prev,
        firstName: data.user.firstName || "",
        lastName: data.user.lastName || "",
      }))

      // Fetch existing profile data to pre-fill
      const profileResponse = await fetch("/api/vendor/profile")
      if (profileResponse.ok) {
        const profileData = await profileResponse.json()
        // Pre-fill with existing profile data
        setFormData((prev) => ({
          ...prev,
          firstName: profileData.profile.firstName || prev.firstName,
          lastName: profileData.profile.lastName || prev.lastName,
          companyName: profileData.profile.companyName || "",
          avatar: profileData.profile.avatar || "",
        }))
      }
    } catch (error) {
      console.error("Auth check error:", error)
      router.push("/auth/login")
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: keyof VendorOnboardingData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const uploadFormData = new FormData()
      uploadFormData.append("file", file)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: uploadFormData,
      })

      if (response.ok) {
        const data = await response.json()
        setFormData((prev) => ({ ...prev, avatar: data.url }))
        toast({
          title: "Image Uploaded",
          description: "Your profile picture has been updated.",
        })
      } else {
        throw new Error("Failed to upload image")
      }
    } catch (error) {
      toast({
        title: "Upload Error",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    setError("")
    setSaving(true)

    try {
      const response = await fetch("/api/vendor/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          profilePictureUrl: formData.avatar,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to save profile")
      }

      toast({
        title: "Welcome to Affilova!",
        description: "Your profile has been set up successfully.",
      })

      router.push("/dashboard/vendor")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Logo variant="stacked" className="h-12 w-auto mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Complete Your Profile</h1>
          <p className="text-sm text-gray-600">Let's set up your vendor profile to get you started</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${s <= step ? "bg-purple-600" : "bg-gray-300"}`}
            />
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg border border-red-200 mb-6">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
          {/* Step 1: Personal Information */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Personal Information</h2>
                  <p className="text-sm text-gray-500">Tell us about yourself</p>
                </div>
              </div>

              {/* Profile Picture */}
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden">
                  {formData.avatar ? (
                    <img
                      src={formData.avatar || "/placeholder.svg"}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-10 h-10 text-gray-400" />
                  )}
                </div>
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="avatar-upload"
                  />
                  <label htmlFor="avatar-upload">
                    <Button variant="outline" size="sm" disabled={uploading} asChild>
                      <span className="cursor-pointer">
                        {uploading ? (
                          <Upload className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Camera className="w-4 h-4 mr-2" />
                        )}
                        {uploading ? "Uploading..." : "Upload Photo"}
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">Optional - JPG, PNG. Max 2MB</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => handleInputChange("firstName", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleInputChange("lastName", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!formData.firstName || !formData.lastName}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Business Information */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Building className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Business Information</h2>
                  <p className="text-sm text-gray-500">Tell us about your business</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  value={formData.companyName}
                  onChange={(e) => handleInputChange("companyName", e.target.value)}
                  placeholder="Your company or brand name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="businessType">Business Type *</Label>
                <Input
                  id="businessType"
                  value={formData.businessType}
                  onChange={(e) => handleInputChange("businessType", e.target.value)}
                  placeholder="e.g., E-commerce, SaaS, Digital Products, Courses"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="websiteUrl">Website URL (Optional)</Label>
                <Input
                  id="websiteUrl"
                  type="url"
                  value={formData.websiteUrl}
                  onChange={(e) => handleInputChange("websiteUrl", e.target.value)}
                  placeholder="https://yourwebsite.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Business Description *</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  placeholder="Tell us about your business and the products you offer..."
                  rows={4}
                  required
                />
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={saving || !formData.companyName || !formData.businessType || !formData.description}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Complete Setup
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          You can update these details anytime from your profile settings
        </p>
      </div>
    </div>
  )
}
