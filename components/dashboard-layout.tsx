"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DashboardSidebar } from "./dashboard-sidebar"

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: "admin" | "vendor" | "affiliate"
  onboardingCompleted: boolean
  profilePictureUrl?: string
}

interface DashboardLayoutProps {
  children: React.ReactNode
  role: "admin" | "vendor" | "affiliate"
}

export function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetchUser()
  }, [])

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/auth/me")
      if (response.ok) {
        const data = await response.json()
        setUser(data.user)

        // Check if user role matches required role
        if (data.user.role !== role) {
          router.push(`/dashboard/${data.user.role}`)
          return
        }

        if (role !== "admin" && !data.user.onboardingCompleted) {
          router.push(`/onboarding/${role}`)
          return
        }
      } else {
        router.push("/auth/login")
      }
    } catch (error) {
      console.error("Error fetching user:", error)
      router.push("/auth/login")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar
        role={role}
        user={{
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          avatar: user.profilePictureUrl,
        }}
      />
      <div className="lg:pl-64">
        <main className="py-6 px-4 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
