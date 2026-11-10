"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TrendingUp, DollarSign, Store, Target } from "lucide-react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface AffiliateDashboardData {
  clicks: number
  conversions: number
  conversionRate: number
  totalCommissions: number
  pendingCommissions: number
  approvedProducts: number
  monthlyPerformance: Array<{ month: string; clicks: number; conversions: number; commissions: number }>
  topProducts: Array<{ name: string; clicks: number; conversions: number; conversionRate: number }>
}

export default function AffiliateDashboard() {
  const [data, setData] = useState<AffiliateDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      const response = await fetch("/api/affiliate/dashboard-stats")
      if (response.ok) {
        const dashboardData = await response.json()
        setData(dashboardData)
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout role="affiliate">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (!data) {
    return (
      <DashboardLayout role="affiliate">
        <div className="text-center py-12">
          <p className="text-gray-600">Failed to load dashboard data</p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="affiliate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Affiliate Dashboard</h1>
            <p className="text-gray-600 mt-1">Track your performance and earnings</p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-blue-900">Total Clicks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">{data.clicks.toLocaleString()}</div>
              <p className="text-xs text-blue-700 mt-1">From your links</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-green-900">Conversions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900">{data.conversions}</div>
              <p className="text-xs text-green-700 mt-1">{data.conversionRate.toFixed(2)}% conversion rate</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-purple-900">Total Earnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-900">
                ₦{(data.totalCommissions / 100).toLocaleString()}
              </div>
              <p className="text-xs text-purple-700 mt-1">Commissions earned</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-orange-900">Pending Earnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-900">
                ₦{(data.pendingCommissions / 100).toLocaleString()}
              </div>
              <p className="text-xs text-orange-700 mt-1">Awaiting payout</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Monthly Performance</CardTitle>
              <CardDescription>Clicks, conversions, and earnings over the last 12 months</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.monthlyPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" />
                  <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb" }} />
                  <Legend />
                  <Line type="monotone" dataKey="clicks" stroke="#3b82f6" strokeWidth={2} name="Clicks" />
                  <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2} name="Conversions" />
                  <Line type="monotone" dataKey="commissions" stroke="#f59e0b" strokeWidth={2} name="Commissions (₦)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Products</CardTitle>
              <CardDescription>Your best converting products</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.topProducts.map((product, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                      <p className="text-xs text-gray-500">
                        {product.conversions} conversions • {product.conversionRate}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-blue-600">{product.clicks} clicks</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/dashboard/affiliate/marketplace">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <Store className="w-8 h-8 text-blue-600 mb-3" />
                <h3 className="font-semibold text-gray-900">Browse Marketplace</h3>
                <p className="text-sm text-gray-600 mt-1">Find products to promote</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/affiliate/products">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <Target className="w-8 h-8 text-green-600 mb-3" />
                <h3 className="font-semibold text-gray-900">My Products</h3>
                <p className="text-sm text-gray-600 mt-1">{data.approvedProducts} approved products</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/affiliate/analytics">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <TrendingUp className="w-8 h-8 text-orange-600 mb-3" />
                <h3 className="font-semibold text-gray-900">View Analytics</h3>
                <p className="text-sm text-gray-600 mt-1">Detailed performance metrics</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/dashboard/affiliate/withdrawals">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <DollarSign className="w-8 h-8 text-purple-600 mb-3" />
                <h3 className="font-semibold text-gray-900">Request Withdrawal</h3>
                <p className="text-sm text-gray-600 mt-1">Withdraw your earnings</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  )
}
