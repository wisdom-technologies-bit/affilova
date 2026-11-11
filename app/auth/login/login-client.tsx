"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, Loader2, Eye, EyeOff, BarChart3, Wallet, Lock } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Logo } from "@/components/brand/logo"

declare global {
  interface Window {
    turnstile: any
  }
}

export default function LoginClientPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(searchParams.get("error") || "")
  const turnstileRef = useRef<HTMLDivElement>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>("")
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    website_url: "", // Honeypot field
  })

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

    // Check if sitekey is configured
    if (!siteKey) {
      setError("Security configuration error. Please contact support.")
      return
    }

    const loadTurnstile = () => {
      const timer = setTimeout(() => {
        if (!window.turnstile) {
          return
        }

        if (!turnstileRef.current) {
          return
        }

        try {
          window.turnstile.render(turnstileRef.current, {
            sitekey: siteKey,
            callback: (token: string) => {
              setTurnstileToken(token)
            },
            "error-callback": () => {
              setTurnstileToken("")
            },
            "timeout-callback": () => {
              setTurnstileToken("")
            },
            "expired-callback": () => {
              setTurnstileToken("")
            },
          })
        } catch (err) {
          // Widget rendering failed silently
        }
      }, 300)

      return () => clearTimeout(timer)
    }

    const ensureScriptLoaded = () => {
      // Already loaded
      if (window.turnstile) {
        return loadTurnstile()
      }

      // Script exists but not loaded yet
      const existingScript = document.querySelector('script[src*="turnstile"]')
      if (existingScript) {
        let retries = 0
        const maxRetries = 50 // 5 seconds with 100ms intervals

        const checkScript = setInterval(() => {
          retries++
          if (window.turnstile) {
            clearInterval(checkScript)
            loadTurnstile()
          } else if (retries >= maxRetries) {
            clearInterval(checkScript)
          }
        }, 100)

        return () => clearInterval(checkScript)
      }

      // Load script
      const script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"
      script.async = true
      script.defer = false

      script.onload = () => {
        loadTurnstile()
      }

      script.onerror = () => {
        setError("Failed to load security verification. Please refresh the page.")
      }

      document.head.appendChild(script)

      return () => {
        // Keep script for other pages
      }
    }

    return ensureScriptLoaded()
  }, [])

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/auth/me")
        if (response.ok) {
          const data = await response.json()
          if (data.user) {
            // Redirect based on role
            if (data.user.role === "admin") {
              router.push("/dashboard/admin")
            } else if (data.user.role === "affiliate" || data.user.role === "vendor") {
              router.push(`/dashboard/${data.user.role}`)
            } else {
              router.push("/dashboard/select-role")
            }
            return
          }
        }
      } catch (err) {
        // Not authenticated, continue showing login
      }
      setCheckingAuth(false)
    }
    checkAuth()
  }, [router])

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleGoogleSignIn = async () => {
    // Require Turnstile verification for Google sign-in too
    if (!turnstileToken) {
      setError("Please complete the security verification before signing in with Google")
      return
    }

    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ turnstileToken }),
      })

      if (!response.ok) {
        throw new Error("Security verification failed")
      }

      const data = await response.json()
      window.location.href = data.authUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize Google sign-in")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    // Validate Turnstile token
    if (!turnstileToken) {
      setError("Please complete the security verification")
      setLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          turnstileToken,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === "google_account_detected") {
          setError("This email is associated with a Google account. Please sign in with Google or reset your password.")
          return
        }
        throw new Error(data.error || "Login failed")
      }

      const redirectTo = searchParams.get("redirect")
      const redirectUrl = redirectTo || data.redirectUrl || "/dashboard/select-role"
      router.push(redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left Side - Image/Information */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-green-600 via-green-500 to-green-700 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-64 h-64 bg-white rounded-full" />
          <div className="absolute bottom-20 left-20 w-80 h-80 bg-white rounded-full" />
        </div>

        <div className="relative z-10 space-y-8">
          <Link href="/" className="flex items-center space-x-2 group">
            <Logo variant="stacked" tone="dark" className="h-12 w-auto" />
            <span className="font-bold text-2xl text-white">Affilova</span>
          </Link>

          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
              Welcome Back to Your Affiliate Success
            </h1>
            <p className="text-lg text-green-100">
              Sign in to access your dashboard, manage your products, and track your earnings in real-time.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <BarChart3 className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Track Your Performance</p>
                <p className="text-green-100 text-sm">Monitor clicks, conversions, and real-time earnings</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <Wallet className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Get Paid on Time</p>
                <p className="text-green-100 text-sm">Receive payouts every Thursday directly to your bank</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <Lock className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Secure & Trusted</p>
                <p className="text-green-100 text-sm">Bank-level security with Squad payment processing</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-4">
          <p className="text-green-100 text-sm">
            Don't have an account?{" "}
            <Link href="/auth/register" className="text-white font-semibold hover:underline">
              Sign up here
            </Link>
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/blog" className="text-green-100 hover:text-white transition">
              Blog
            </Link>
            <Link href="/how-it-works" className="text-green-100 hover:text-white transition">
              How It Works
            </Link>
            <Link href="/help" className="text-green-100 hover:text-white transition">
              Help Center
            </Link>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile Header */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex justify-center mb-4">
              <Logo variant="stacked" className="h-12 w-auto" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
            <p className="text-gray-600">Sign in to your Affilova account</p>
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:block text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Sign In</h1>
            <p className="text-gray-600">Access your dashboard and manage your business</p>
          </div>

          <div className="space-y-6">
            <Button
              type="button"
              variant="outline"
              className="w-full border-2 hover:bg-gray-50 h-12 bg-white shadow-sm"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-start gap-3 text-red-600 bg-red-50 p-4 rounded-lg border border-red-200">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {/* Honeypot field - hidden from users */}
              <input
                type="text"
                name="website_url"
                value={formData.website_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, website_url: e.target.value }))}
                style={{ display: "none" }}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />

              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700 font-medium">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  className="h-12 border-gray-300 focus:border-green-500 focus:ring-green-500"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700 font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => handleInputChange("password", e.target.value)}
                    className="h-12 border-gray-300 focus:border-green-500 focus:ring-green-500 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                  <span className="text-sm text-gray-600">Remember me</span>
                </label>
                <Link href="/auth/forgot-password" className="text-sm text-green-600 hover:text-green-700 font-medium">
                  Forgot password?
                </Link>
              </div>

              {/* Cloudflare Turnstile Widget */}
              <div className="flex justify-center my-4">
                <div ref={turnstileRef} />
              </div>

              <Button
                type="submit"
                className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-semibold text-lg"
                disabled={loading}
              >
                {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="text-center">
              <p className="text-gray-600 text-sm">
                Don't have an account?{" "}
                <Link href="/auth/register" className="text-green-600 hover:text-green-700 font-semibold">
                  Create one now
                </Link>
              </p>
            </div>
          </div>

          {/* Privacy & Terms Links */}
          <div className="flex items-center justify-center gap-4 text-xs text-gray-500 pt-4">
            <Link href="/privacy-policy" className="hover:text-green-600 transition-colors">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="/terms-of-service" className="hover:text-green-600 transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
