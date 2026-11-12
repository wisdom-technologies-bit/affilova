"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Loader2, Mail, Shield, BarChart3, Users, Zap } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Logo } from "@/components/brand/logo"

declare global {
  interface Window {
    turnstile: any
  }
}

export default function RegisterClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [error, setError] = useState("")
  const [step, setStep] = useState<"form" | "otp">("form")
  const [otpSent, setOtpSent] = useState(false)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>("")
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    phone: "",
    otpCode: "",
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
        // Not authenticated, continue showing register
      }
      setCheckingAuth(false)
    }
    checkAuth()
  }, [router])

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleGoogleSignUp = async () => {
    // Require Turnstile verification for Google sign-up too
    if (!turnstileToken) {
      setError("Please complete the security verification before signing up with Google")
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
      setError(err instanceof Error ? err.message : "Failed to initialize Google sign-up")
    }
  }

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    // Validate Turnstile token
    if (!turnstileToken) {
      setError("Please complete the security verification")
      setLoading(false)
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match")
      setLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          type: "registration",
          turnstileToken,
          firstName: formData.firstName,
          lastName: formData.lastName,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to send OTP")
      }

      setStep("otp")
      setOtpSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP")
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // First verify OTP
      const otpResponse = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          otpCode: formData.otpCode,
          type: "registration",
        }),
      })

      const otpData = await otpResponse.json()

      if (!otpResponse.ok) {
        throw new Error(otpData.error || "OTP verification failed")
      }

      // Then register user
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone || undefined,
        }),
      })

      const registerData = await registerResponse.json()

      if (!registerResponse.ok) {
        throw new Error(registerData.error || "Registration failed")
      }

      // Redirect to role selection
      const redirectUrl = registerData.redirectUrl || "/dashboard/select-role"
      router.push(redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setLoading(false)
    }
  }

  const handleResendOTP = async () => {
    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          type: "registration",
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to resend OTP")
      }

      setOtpSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend OTP")
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
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-green-600 via-green-500 to-green-700 p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-64 h-64 bg-white rounded-full" />
          <div className="absolute bottom-20 left-20 w-80 h-80 bg-white rounded-full" />
        </div>

        <div className="relative z-10 space-y-8">
          <Link href="/" className="flex items-center group">
            <Logo variant="horizontal" tone="white" className="h-10 w-auto" />
          </Link>

          <div className="space-y-6">
            <Badge className="bg-white/20 text-white hover:bg-white/20 backdrop-blur-sm">
              Free for first 6 months!
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
              Join the Premier Affiliate Marketplace
            </h1>
            <p className="text-lg text-green-100">
              Create your account and start earning with the best affiliate program in the market.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <BarChart3 className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Real-Time Analytics</p>
                <p className="text-green-100 text-sm">Track your performance with detailed dashboards</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <Users className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Join 10,000+ Affiliates</p>
                <p className="text-green-100 text-sm">Connect with a thriving community of earners</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <Zap className="w-6 h-6 text-white flex-shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-white">Instant Payouts</p>
                <p className="text-green-100 text-sm">Get paid every Thursday directly to your bank</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-4">
          <p className="text-green-100 text-sm">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-white font-semibold hover:underline">
              Sign in here
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

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md space-y-6">
          {/* Mobile Header */}
          <div className="lg:hidden text-center mb-6">
            <div className="flex justify-center mb-4">
              <Logo variant="stacked" className="h-12 w-auto" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {step === "form" ? "Create Your Account" : "Verify Your Email"}
            </h1>
            <p className="text-gray-600 text-sm">
              {step === "form"
                ? "Join the premier affiliate marketplace"
                : `Enter the 6-digit code sent to ${formData.email}`}
            </p>
            {step === "form" && <Badge className="mt-2 bg-green-100 text-green-800">Free for first 6 months!</Badge>}
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:block text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {step === "form" ? "Create Your Account" : "Verify Your Email"}
            </h1>
            <p className="text-gray-600">
              {step === "form"
                ? "Join the premier affiliate marketplace"
                : `Enter the 6-digit code sent to ${formData.email}`}
            </p>
          </div>

          {step === "form" ? (
            <div className="space-y-6">
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 border-2 bg-white shadow-sm hover:bg-gray-50"
                onClick={handleGoogleSignUp}
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

              <form onSubmit={handleSendOTP} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                {/* Honeypot field - hidden from users */}
                <input
                  type="text"
                  name="website_url"
                  value={formData.website_url}
                  onChange={(e) => handleInputChange("website_url", e.target.value)}
                  style={{ display: "none" }}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-gray-700 font-medium">
                      First Name
                    </Label>
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) => handleInputChange("firstName", e.target.value)}
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-gray-700 font-medium">
                      Last Name
                    </Label>
                    <Input
                      id="lastName"
                      value={formData.lastName}
                      onChange={(e) => handleInputChange("lastName", e.target.value)}
                      className="h-11"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-700 font-medium">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    className="h-11"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-gray-700 font-medium">
                    Phone Number
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-700 font-medium">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange("password", e.target.value)}
                    className="h-11"
                    required
                    minLength={8}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-gray-700 font-medium">
                    Confirm Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                    className="h-11"
                    required
                    minLength={8}
                  />
                </div>

                {/* Cloudflare Turnstile Widget */}
                <div className="flex justify-center my-4">
                  <div ref={turnstileRef} />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-lg font-semibold"
                  disabled={loading}
                >
                  {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                  Send Verification Code
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              {/* OTP Verification Step */}
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="bg-green-100 p-4 rounded-full">
                    <Mail className="w-8 h-8 text-green-600" />
                  </div>
                </div>
                <p className="text-gray-600">
                  We've sent a 6-digit verification code to your email address. Please enter it below to complete your
                  registration.
                </p>
              </div>

              <form onSubmit={handleVerifyAndRegister} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="otpCode" className="text-gray-700 font-medium">
                    Verification Code
                  </Label>
                  <Input
                    id="otpCode"
                    type="text"
                    value={formData.otpCode}
                    onChange={(e) => handleInputChange("otpCode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    className="text-center text-2xl tracking-[0.5em] h-14 font-mono"
                    maxLength={6}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-green-600 hover:bg-green-700 text-lg font-semibold"
                  disabled={loading || formData.otpCode.length !== 6}
                >
                  {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
                  <Shield className="w-5 h-5 mr-2" />
                  Verify & Create Account
                </Button>
              </form>

              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  Didn't receive the code?{" "}
                  <button
                    onClick={handleResendOTP}
                    className="text-green-600 hover:underline font-medium"
                    disabled={loading}
                  >
                    Resend Code
                  </button>
                </p>
                <button onClick={() => setStep("form")} className="text-sm text-gray-500 hover:underline">
                  Change Email Address
                </button>
              </div>
            </div>
          )}

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-green-600 hover:underline font-semibold">
                Sign in
              </Link>
            </p>
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
