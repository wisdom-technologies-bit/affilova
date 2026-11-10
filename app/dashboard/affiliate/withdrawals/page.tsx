"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { DashboardLayout } from "@/components/dashboard-layout"
import { CreditCard, Plus, Calendar, DollarSign, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface WithdrawalRequest {
  id: string
  amount: number
  status: "pending" | "approved" | "rejected" | "completed"
  requested_at: string
  processed_at?: string
  bank_name: string
  account_number: string
  account_name: string
  rejection_reason?: string
}

interface Balance {
  available: number
  pending: number
  total_earned: number
}

export default function AffiliateWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [balance, setBalance] = useState<Balance>({ available: 0, pending: 0, total_earned: 0 })
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [withdrawalAmount, setWithdrawalAmount] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetchWithdrawals()
    fetchBalance()
  }, [])

  const fetchWithdrawals = async () => {
    try {
      console.log("Fetching affiliate withdrawals")
      const response = await fetch("/api/affiliate/withdrawals")
      if (response.ok) {
        const data = await response.json()
        console.log("Withdrawals data:", data)
        setWithdrawals(data.withdrawals)
      }
    } catch (error) {
      console.error("Error fetching withdrawals:", error)
    }
  }

  const fetchBalance = async () => {
    try {
      console.log("Fetching affiliate balance")
      const response = await fetch("/api/affiliate/balance")
      if (response.ok) {
        const data = await response.json()
        console.log("Balance data:", data)
        setBalance(data.balance)
      }
    } catch (error) {
      console.error("Error fetching balance:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleWithdrawalRequest = async () => {
    if (!withdrawalAmount || Number.parseFloat(withdrawalAmount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid withdrawal amount",
        variant: "destructive",
      })
      return
    }

    if (Number.parseFloat(withdrawalAmount) > balance.available) {
      toast({
        title: "Insufficient Balance",
        description: "Withdrawal amount exceeds available balance",
        variant: "destructive",
      })
      return
    }

    if (Number.parseFloat(withdrawalAmount) < 1000) {
      toast({
        title: "Minimum Amount",
        description: "Minimum withdrawal amount is ₦1,000",
        variant: "destructive",
      })
      return
    }

    setRequesting(true)
    try {
      console.log("Requesting withdrawal:", withdrawalAmount)
      const response = await fetch("/api/affiliate/withdrawals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Number.parseFloat(withdrawalAmount),
        }),
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: "Withdrawal Requested",
          description: "Your withdrawal request has been submitted for review",
        })
        setWithdrawalAmount("")
        setIsDialogOpen(false)
        fetchWithdrawals()
        fetchBalance()
      } else {
        throw new Error(data.error || "Failed to request withdrawal")
      }
    } catch (error) {
      console.error("Withdrawal request error:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to request withdrawal",
        variant: "destructive",
      })
    } finally {
      setRequesting(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800"
      case "approved":
        return "bg-blue-100 text-blue-800"
      case "completed":
        return "bg-green-100 text-green-800"
      case "rejected":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
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

  return (
    <DashboardLayout role="affiliate">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Withdrawals</h1>
            <p className="text-gray-600">Manage your earnings and withdrawal requests</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-green-600 hover:bg-green-700" disabled={balance.available < 1000}>
                <Plus className="w-4 h-4 mr-2" />
                Request Withdrawal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request Withdrawal</DialogTitle>
                <DialogDescription>Enter the amount you want to withdraw. Minimum amount is ₦1,000.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="amount">Withdrawal Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="Enter amount"
                    value={withdrawalAmount}
                    onChange={(e) => setWithdrawalAmount(e.target.value)}
                    min="1000"
                    max={balance.available}
                  />
                  <p className="text-sm text-gray-600 mt-1">Available balance: ₦{balance.available.toLocaleString()}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleWithdrawalRequest} disabled={requesting}>
                    {requesting ? "Processing..." : "Request Withdrawal"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Balance</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">₦{balance.available.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Ready for withdrawal</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Balance</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">₦{balance.pending.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Processing withdrawals</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₦{balance.total_earned.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">All time earnings</p>
            </CardContent>
          </Card>
        </div>

        {/* Withdrawal Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600" />
              Withdrawal Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-gray-600">
              <p>• Minimum withdrawal amount: ₦1,000</p>
              <p>• Withdrawals are processed every Thursday</p>
              <p>• Processing time: 1-3 business days after approval</p>
              <p>• Make sure your bank details are up to date in your profile</p>
            </div>
          </CardContent>
        </Card>

        {/* Withdrawal History */}
        <Card>
          <CardHeader>
            <CardTitle>Withdrawal History</CardTitle>
            <CardDescription>Your recent withdrawal requests</CardDescription>
          </CardHeader>
          <CardContent>
            {withdrawals.length === 0 ? (
              <div className="text-center py-8">
                <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No withdrawals yet</h3>
                <p className="text-gray-600">Your withdrawal requests will appear here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {withdrawals.map((withdrawal) => (
                  <div key={withdrawal.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-medium">₦{withdrawal.amount.toLocaleString()}</h4>
                        <Badge className={getStatusColor(withdrawal.status)}>
                          {withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600">
                        {withdrawal.bank_name} • {withdrawal.account_number}
                      </p>
                      <p className="text-sm text-gray-600">
                        Requested: {new Date(withdrawal.requested_at).toLocaleDateString()}
                      </p>
                      {withdrawal.processed_at && (
                        <p className="text-sm text-gray-600">
                          Processed: {new Date(withdrawal.processed_at).toLocaleDateString()}
                        </p>
                      )}
                      {withdrawal.rejection_reason && (
                        <p className="text-sm text-red-600 mt-1">Reason: {withdrawal.rejection_reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
