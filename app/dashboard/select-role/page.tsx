"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Loader2, Building, Target } from "lucide-react"

export default function SelectRolePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedRole, setSelectedRole] = useState<"vendor" | "affiliate" | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    checkAuthentication()
  }, [])

  const checkAuthentication = async () => {
    try {
      const response = await fetch("/api/auth/me")
      if (response.ok) {
        const userData = await response.json()

        // If user already has a role, redirect to their dashboard
        if (userData.user.role && userData.user.role !== "user") {
          router.push(`/dashboard/${userData.user.role}`)
          return
        }
      } else {
        router.push("/auth/login")
      }
    } catch (error) {
      console.error("Auth check error:", error)
      router.push("/auth/login")
    } finally {
      setCheckingAuth(false)
    }
  }

  const handleRoleSelection = async () => {
    if (!selectedRole) return

    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/auth/select-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: selectedRole }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to select role")
      }

      router.push(`/onboarding/${selectedRole}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select role")
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <img src="/affilova-logo.png" alt="Affilova" className="h-12 w-auto mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Affilova!</h1>
          <p className="text-xl text-gray-600 mb-2">Choose how you want to use our platform</p>
          <Badge className="bg-green-100 text-green-800">Free for first 6 months!</Badge>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-md mb-6 max-w-md mx-auto">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Affiliate Option */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedRole === "affiliate" ? "ring-2 ring-green-500 bg-green-50" : "hover:bg-gray-50"
            }`}
            onClick={() => setSelectedRole("affiliate")}
          >
            <CardHeader className="text-center pb-4">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Target className="w-8 h-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Affiliate Marketer</CardTitle>
              <CardDescription className="text-base">
                Promote products and earn commissions from successful sales
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Earn up to 50% commission on sales</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Access to marketing materials and tools</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Real-time analytics and tracking</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Weekly payouts every Thursday</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vendor Option */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-lg ${
              selectedRole === "vendor" ? "ring-2 ring-green-500 bg-green-50" : "hover:bg-gray-50"
            }`}
            onClick={() => setSelectedRole("vendor")}
          >
            <CardHeader className="text-center pb-4">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building className="w-8 h-8 text-purple-600" />
              </div>
              <CardTitle className="text-2xl">Product Vendor</CardTitle>
              <CardDescription className="text-base">
                List your products and work with affiliate marketers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Access to thousands of affiliates</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Comprehensive sales analytics</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Automated commission management</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">Secure payment processing</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button
            onClick={handleRoleSelection}
            disabled={!selectedRole || loading}
            size="lg"
            className="bg-green-600 hover:bg-green-700 px-8"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Continue as {selectedRole ? (selectedRole === "affiliate" ? "Affiliate" : "Vendor") : "..."}
          </Button>
          <p className="text-sm text-gray-500 mt-4">You can always change your role later in your profile settings</p>
        </div>
      </div>
    </div>
  )
}
