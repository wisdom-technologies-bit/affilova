"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Check, X, Search, DollarSign, Clock, CheckCircle, CreditCard } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface WithdrawalRequest {
  id: string
  alphanumeric_id: string
  user_name: string
  user_email: string
  amount: number
  status: string
  bank_name: string
  account_number: string
  account_name: string
  created_at: string
}

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const { toast } = useToast()

  useEffect(() => {
    fetchWithdrawals()
  }, [])

  const fetchWithdrawals = async () => {
    try {
      const response = await fetch("/api/admin/withdrawals")
      if (response.ok) {
        const data = await response.json()
        setWithdrawals(data.withdrawals)
      }
    } catch (error) {
      console.error("Error fetching withdrawals:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleApproveWithdrawal = async (withdrawalId: string) => {
    try {
      const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/approve`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Withdrawal Approved",
          description: "Withdrawal has been approved for processing.",
        })
        fetchWithdrawals()
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve withdrawal",
        variant: "destructive",
      })
    }
  }

  const handleRejectWithdrawal = async (withdrawalId: string) => {
    try {
      const response = await fetch(`/api/admin/withdrawals/${withdrawalId}/reject`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Withdrawal Rejected",
          description: "Withdrawal has been rejected.",
        })
        fetchWithdrawals()
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reject withdrawal",
        variant: "destructive",
      })
    }
  }

  const filteredWithdrawals = withdrawals.filter((withdrawal) => {
    const matchesSearch =
      withdrawal.user_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      withdrawal.user_email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "all" || withdrawal.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const pendingAmount = withdrawals.filter((w) => w.status === "pending").reduce((sum, w) => sum + w.amount, 0)
  const approvedAmount = withdrawals.filter((w) => w.status === "approved").reduce((sum, w) => sum + w.amount, 0)

  if (loading) {
    return (
      <DashboardLayout role="admin">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Withdrawal Requests</h1>
          <p className="text-gray-600">Review and process withdrawal requests</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{withdrawals.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Amount</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{(pendingAmount / 100).toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved Amount</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{(approvedAmount / 100).toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{(approvedAmount / 100).toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>

        {/* Withdrawals Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <CardTitle>Withdrawal Requests</CardTitle>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search withdrawals..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-full sm:w-64"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredWithdrawals.map((withdrawal) => (
                <Card key={withdrawal.id} className="border-l-4 border-l-gray-200">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg">{withdrawal.user_name}</h3>
                          <Badge
                            variant={
                              withdrawal.status === "approved"
                                ? "default"
                                : withdrawal.status === "pending"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {withdrawal.status}
                          </Badge>
                        </div>
                        <p className="text-gray-600 text-sm mb-3">{withdrawal.user_email}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Amount:</span>
                            <span className="ml-2 text-lg font-bold">
                              ₦{(withdrawal.amount / 100).toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium">Date:</span>
                            <span className="ml-2">{new Date(withdrawal.created_at).toLocaleDateString()}</span>
                          </div>
                          <div>
                            <span className="font-medium">Bank:</span>
                            <span className="ml-2">{withdrawal.bank_name}</span>
                          </div>
                          <div>
                            <span className="font-medium">Account:</span>
                            <span className="ml-2">
                              {withdrawal.account_name} - {withdrawal.account_number}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        {withdrawal.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => handleApproveWithdrawal(withdrawal.alphanumeric_id)}
                            >
                              <Check className="w-4 h-4 mr-2" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRejectWithdrawal(withdrawal.alphanumeric_id)}
                            >
                              <X className="w-4 h-4 mr-2" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredWithdrawals.length === 0 && (
                <div className="text-center py-12">
                  <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No withdrawal requests</h3>
                  <p className="text-gray-600">No withdrawal requests match your current filters.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
