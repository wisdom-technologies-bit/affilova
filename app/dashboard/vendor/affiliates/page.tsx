"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Search, Users, TrendingUp, DollarSign, Mail, Eye } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Affiliate {
  id: string
  name: string
  email: string
  total_sales: number
  total_commission: number
  conversion_rate: number
  joined_date: string
  status: "active" | "inactive"
  experience_level: string
  marketing_channels: string[]
}

export default function VendorAffiliatesPage() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  useEffect(() => {
    fetchAffiliates()
  }, [])

  const fetchAffiliates = async () => {
    try {
      console.log("Fetching vendor affiliates")
      const response = await fetch("/api/vendor/affiliates")
      if (response.ok) {
        const data = await response.json()
        console.log("Affiliates data:", data)
        setAffiliates(data.affiliates)
      }
    } catch (error) {
      console.error("Error fetching affiliates:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredAffiliates = affiliates.filter((affiliate) => {
    const matchesSearch =
      affiliate.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      affiliate.email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || affiliate.status === statusFilter
    return matchesSearch && matchesStatus
  })

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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Affiliates</h1>
          <p className="text-gray-600">Manage your affiliate partners and track their performance</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Affiliates</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{affiliates.length}</div>
              <p className="text-xs text-muted-foreground">
                {affiliates.filter((a) => a.status === "active").length} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{affiliates.reduce((sum, a) => sum + a.total_sales, 0)}</div>
              <p className="text-xs text-muted-foreground">From all affiliates</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Commissions</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ₦{affiliates.reduce((sum, a) => sum + a.total_commission, 0).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">Paid to affiliates</p>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search affiliates..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Affiliates List */}
        {filteredAffiliates.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No affiliates found</h3>
              <p className="text-gray-600">Affiliates promoting your products will appear here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredAffiliates.map((affiliate) => (
              <Card key={affiliate.id}>
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-xl">{affiliate.name}</h3>
                          <p className="text-gray-600">{affiliate.email}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant={affiliate.status === "active" ? "default" : "secondary"}>
                              {affiliate.status}
                            </Badge>
                            <Badge variant="outline" className="capitalize">
                              {affiliate.experience_level}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm mb-4">
                        <div>
                          <span className="text-gray-500">Total Sales:</span>
                          <p className="font-semibold">{affiliate.total_sales}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Commission Earned:</span>
                          <p className="font-semibold">₦{affiliate.total_commission.toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Conversion Rate:</span>
                          <p className="font-semibold">{affiliate.conversion_rate.toFixed(2)}%</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Joined:</span>
                          <p className="font-semibold">{new Date(affiliate.joined_date).toLocaleDateString()}</p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <span className="text-gray-500 text-sm">Marketing Channels:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {affiliate.marketing_channels.map((channel, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {channel}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                      <Button variant="outline" size="sm">
                        <Mail className="w-4 h-4 mr-2" />
                        Contact
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
