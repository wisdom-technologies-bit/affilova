"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardLayout } from "@/components/dashboard-layout"
import { User, Target, Globe, Camera, Upload } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface AffiliateProfile {
  firstName: string
  lastName: string
  email: string
  companyName: string
  experienceLevel: string
  marketingChannels: string[]
  websiteUrl: string
  socialMediaLinks: {
    facebook: string
    twitter: string
    instagram: string
    linkedin: string
    youtube: string
  }
  avatar: string
}

export default function AffiliateProfilePage() {
  const [profile, setProfile] = useState<AffiliateProfile>({
    firstName: "",
    lastName: "",
    email: "",
    companyName: "",
    experienceLevel: "",
    marketingChannels: [],
    websiteUrl: "",
    socialMediaLinks: {
      facebook: "",
      twitter: "",
      instagram: "",
      linkedin: "",
      youtube: "",
    },
    avatar: "",
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const response = await fetch("/api/affiliate/profile")
      if (response.ok) {
        const data = await response.json()
        setProfile(data.profile)
      }
    } catch (error) {
      console.error("Error fetching profile:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/affiliate/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...profile,
          profilePictureUrl: profile.avatar,
        }),
      })

      if (response.ok) {
        toast({
          title: "Profile Updated",
          description: "Your profile has been successfully updated.",
        })
      } else {
        throw new Error("Failed to update profile")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setProfile((prev) => ({ ...prev, avatar: data.url }))
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

  const handleInputChange = (field: keyof AffiliateProfile, value: any) => {
    setProfile((prev) => ({ ...prev, [field]: value }))
  }

  const handleSocialMediaChange = (platform: string, value: string) => {
    setProfile((prev) => ({
      ...prev,
      socialMediaLinks: {
        ...prev.socialMediaLinks,
        [platform]: value,
      },
    }))
  }

  const handleMarketingChannelChange = (channel: string, checked: boolean) => {
    setProfile((prev) => ({
      ...prev,
      marketingChannels: checked
        ? [...prev.marketingChannels, channel]
        : prev.marketingChannels.filter((c) => c !== channel),
    }))
  }

  const marketingChannelOptions = [
    "Social Media",
    "Email Marketing",
    "Content Marketing",
    "Paid Advertising",
    "SEO",
    "Influencer Marketing",
  ]

  if (loading) {
    return (
      <DashboardLayout role="affiliate">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="affiliate">
      <div className="space-y-8 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profile Settings</h1>
          <p className="text-gray-600">Manage your account information and preferences</p>
        </div>

        {/* Profile Picture Section */}
        <section className="pb-8 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">Profile Picture</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
              {profile.avatar ? (
                <img src={profile.avatar || "/placeholder.svg"} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-12 h-12 text-gray-400" />
              )}
            </div>
            <div>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="avatar-upload" />
              <label htmlFor="avatar-upload">
                <Button variant="outline" disabled={uploading} asChild>
                  <span className="cursor-pointer">
                    {uploading ? <Upload className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                    {uploading ? "Uploading..." : "Change Photo"}
                  </span>
                </Button>
              </label>
              <p className="text-sm text-gray-500 mt-2">JPG, PNG or GIF. Max size 2MB.</p>
            </div>
          </div>
        </section>

        {/* Personal Information Section */}
        <section className="pb-8 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">Personal Information</h2>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={profile.firstName}
                  onChange={(e) => handleInputChange("firstName", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={profile.lastName}
                  onChange={(e) => handleInputChange("lastName", e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={profile.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                disabled
              />
              <p className="text-sm text-gray-500 mt-1">Email cannot be changed</p>
            </div>
            <div>
              <Label htmlFor="companyName">Company/Business Name (Optional)</Label>
              <Input
                id="companyName"
                value={profile.companyName}
                onChange={(e) => handleInputChange("companyName", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Marketing Information Section */}
        <section className="pb-8 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <Target className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">Marketing Information</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="experienceLevel">Experience Level</Label>
              <Select
                onValueChange={(value) => handleInputChange("experienceLevel", value)}
                value={profile.experienceLevel}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select your experience level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner (0-1 years)</SelectItem>
                  <SelectItem value="intermediate">Intermediate (1-3 years)</SelectItem>
                  <SelectItem value="advanced">Advanced (3-5 years)</SelectItem>
                  <SelectItem value="expert">Expert (5+ years)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Marketing Channels</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {marketingChannelOptions.map((channel) => (
                  <div key={channel} className="flex items-center space-x-2">
                    <Checkbox
                      id={channel}
                      checked={profile.marketingChannels.includes(channel)}
                      onCheckedChange={(checked) => handleMarketingChannelChange(channel, checked as boolean)}
                    />
                    <Label htmlFor={channel} className="text-sm">
                      {channel}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="websiteUrl">Website/Blog URL</Label>
              <Input
                id="websiteUrl"
                type="url"
                value={profile.websiteUrl}
                onChange={(e) => handleInputChange("websiteUrl", e.target.value)}
                placeholder="https://yourwebsite.com"
              />
            </div>
          </div>
        </section>

        {/* Social Media Links Section */}
        <section className="pb-8">
          <div className="flex items-center gap-3 mb-6">
            <Globe className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">Social Media Links</h2>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="facebook">Facebook</Label>
                <Input
                  id="facebook"
                  value={profile.socialMediaLinks.facebook}
                  onChange={(e) => handleSocialMediaChange("facebook", e.target.value)}
                  placeholder="https://facebook.com/yourpage"
                />
              </div>
              <div>
                <Label htmlFor="twitter">Twitter</Label>
                <Input
                  id="twitter"
                  value={profile.socialMediaLinks.twitter}
                  onChange={(e) => handleSocialMediaChange("twitter", e.target.value)}
                  placeholder="https://twitter.com/yourusername"
                />
              </div>
              <div>
                <Label htmlFor="instagram">Instagram</Label>
                <Input
                  id="instagram"
                  value={profile.socialMediaLinks.instagram}
                  onChange={(e) => handleSocialMediaChange("instagram", e.target.value)}
                  placeholder="https://instagram.com/yourusername"
                />
              </div>
              <div>
                <Label htmlFor="linkedin">LinkedIn</Label>
                <Input
                  id="linkedin"
                  value={profile.socialMediaLinks.linkedin}
                  onChange={(e) => handleSocialMediaChange("linkedin", e.target.value)}
                  placeholder="https://linkedin.com/in/yourprofile"
                />
              </div>
              <div>
                <Label htmlFor="youtube">YouTube</Label>
                <Input
                  id="youtube"
                  value={profile.socialMediaLinks.youtube}
                  onChange={(e) => handleSocialMediaChange("youtube", e.target.value)}
                  placeholder="https://youtube.com/yourchannel"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
