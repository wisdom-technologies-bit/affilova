"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardLayout } from "@/components/dashboard-layout"
import { CreditCard, AlertCircle, CheckCircle2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface PaymentInfo {
  bankName: string
  accountNumber: string
  accountName: string
  bankCode: string
}

export default function AffiliatePaymentInformationPage() {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>({
    bankName: "",
    accountNumber: "",
    accountName: "",
    bankCode: "",
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetchPaymentInfo()
  }, [])

  const fetchPaymentInfo = async () => {
    try {
      const response = await fetch("/api/affiliate/profile")
      if (response.ok) {
        const data = await response.json()
        setPaymentInfo({
          bankName: data.profile.bankName || "",
          accountNumber: data.profile.accountNumber || "",
          accountName: data.profile.accountName || "",
          bankCode: data.profile.bankCode || "",
        })
      }
    } catch (error) {
      console.error("Error fetching payment info:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/affiliate/payment-info", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentInfo),
      })

      if (response.ok) {
        toast({
          title: "Payment Information Updated",
          description: "Your payment details have been saved successfully.",
        })
      } else {
        throw new Error("Failed to update payment information")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update payment information. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleInputChange = (field: keyof PaymentInfo, value: string) => {
    setPaymentInfo((prev) => ({ ...prev, [field]: value }))
  }

  const isComplete = paymentInfo.bankName && paymentInfo.accountNumber && paymentInfo.accountName

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
      <div className="max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Payment Information</h1>
          <p className="text-gray-600">Manage your bank details for receiving commission payouts</p>
        </div>

        {/* Status Banner */}
        {isComplete ? (
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg mb-6">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <div>
              <p className="font-medium text-green-800">Payment information is complete</p>
              <p className="text-sm text-green-600">You're all set to receive payouts every Thursday</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <div>
              <p className="font-medium text-amber-800">Payment information incomplete</p>
              <p className="text-sm text-amber-600">Please add your bank details to receive payouts</p>
            </div>
          </div>
        )}

        {/* Payment Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bank Account Details</h2>
              <p className="text-sm text-gray-500">Your Nigerian bank account for receiving payments</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bankName">Bank Name *</Label>
                <Input
                  id="bankName"
                  value={paymentInfo.bankName}
                  onChange={(e) => handleInputChange("bankName", e.target.value)}
                  placeholder="e.g., First Bank of Nigeria"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bankCode">Bank Code</Label>
                <Input
                  id="bankCode"
                  value={paymentInfo.bankCode}
                  onChange={(e) => handleInputChange("bankCode", e.target.value)}
                  placeholder="e.g., 011"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number *</Label>
                <Input
                  id="accountNumber"
                  value={paymentInfo.accountNumber}
                  onChange={(e) => handleInputChange("accountNumber", e.target.value)}
                  placeholder="1234567890"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountName">Account Name *</Label>
                <Input
                  id="accountName"
                  value={paymentInfo.accountName}
                  onChange={(e) => handleInputChange("accountName", e.target.value)}
                  placeholder="Account holder name"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg mb-6">
              <AlertCircle className="w-5 h-5 text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-700 mb-1">Important Information</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Payments are processed every Thursday</li>
                  <li>Minimum withdrawal amount is ₦5,000</li>
                  <li>Ensure your account name matches your registered name</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving ? "Saving..." : "Save Payment Information"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
