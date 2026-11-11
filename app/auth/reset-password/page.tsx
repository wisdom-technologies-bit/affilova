"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, CheckCircle, Loader2, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react"
import { Logo } from "@/components/brand/logo"

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [token, setToken] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const tokenParam = searchParams.get("token")
    if (tokenParam) {
      setToken(tokenParam)
    } else {
      setError("Invalid reset link. Please request a new password reset.")
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to reset password")
      }

      setSuccess(true)

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push("/auth/login")
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center py-12 px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <Logo variant="stacked" className="h-12 w-auto" />
          </div>
          <div className="flex justify-center mb-6">
            <div className="bg-green-100 p-4 rounded-full">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Password Reset Successful</h1>
          <p className="text-gray-600 mb-6">
            Your password has been successfully reset. You can now sign in with your new password.
          </p>

          <div className="bg-green-50 border border-green-200 p-4 rounded-lg mb-6">
            <p className="text-sm text-green-800">Redirecting to sign in page in 3 seconds...</p>
          </div>

          <Link href="/auth/login">
            <Button className="bg-green-600 hover:bg-green-700 h-12 px-8 text-lg font-semibold">Sign In Now</Button>
          </Link>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center py-12 px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <Logo variant="stacked" className="h-12 w-auto" />
          </div>
          <div className="flex justify-center mb-6">
            <div className="bg-red-100 p-4 rounded-full">
              <AlertCircle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Invalid Reset Link</h1>
          <p className="text-gray-600 mb-6">This password reset link is invalid or has expired.</p>

          <div className="bg-red-50 border border-red-200 p-4 rounded-lg mb-6">
            <p className="text-sm text-red-800">Please request a new password reset link.</p>
          </div>

          <div className="space-y-3">
            <Link href="/auth/forgot-password">
              <Button className="bg-green-600 hover:bg-green-700 h-12 px-8 text-lg font-semibold">
                Request New Reset Link
              </Button>
            </Link>
            <Link href="/auth/login" className="text-sm text-green-600 hover:underline block font-medium mt-4">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <Logo variant="stacked" className="h-12 w-auto" />
          </div>
          <div className="flex justify-center mb-4">
            <div className="bg-green-100 p-4 rounded-full">
              <ShieldCheck className="w-8 h-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Reset Your Password</h1>
          <p className="text-gray-600">Enter your new password below.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg border border-red-200">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password" className="text-gray-700 font-medium">
              New Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                className="h-12 pl-10 pr-10"
                required
                minLength={8}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-500">Password must be at least 8 characters long</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-gray-700 font-medium">
              Confirm New Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="h-12 pl-10 pr-10"
                required
                minLength={8}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-lg font-semibold"
            disabled={loading}
          >
            {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            Reset Password
          </Button>
        </form>

        <div className="text-center mt-8">
          <Link href="/auth/login" className="text-sm text-green-600 hover:underline font-medium">
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
