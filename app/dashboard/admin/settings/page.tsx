"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Save, DollarSign, Shield, Bell } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface PlatformSettings {
  platformCommission: number
  affiliateRegistrationFee: number
  payoutDay: string
  autoPayouts: boolean
  emailNotifications: boolean
  maintenanceMode: boolean
  allowNewRegistrations: boolean
  requireEmailVerification: boolean
  minimumWithdrawal: number
  maxCommissionRate: number
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings>({
    platformCommission: 10,
    affiliateRegistrationFee: 0,
    payoutDay: "thursday",
    autoPayouts: false,
    emailNotifications: true,
    maintenanceMode: false,
    allowNewRegistrations: true,
    requireEmailVerification: true,
    minimumWithdrawal: 5000,
    maxCommissionRate: 50,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/admin/settings")
      if (response.ok) {
        const data = await response.json()
        setSettings(data.settings)
      }
    } catch (error) {
      console.error("Error fetching settings:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      })

      if (response.ok) {
        toast({
          title: "Settings Saved",
          description: "Platform settings have been updated successfully.",
        })
      } else {
        throw new Error("Failed to save settings")
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const updateSetting = (key: keyof PlatformSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Platform Settings</h1>
            <p className="text-gray-600">Configure platform-wide settings and preferences</p>
          </div>
          <Button onClick={handleSaveSettings} disabled={saving} className="bg-green-600 hover:bg-green-700">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        {/* Commission Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Commission & Fees
            </CardTitle>
            <CardDescription>Configure commission rates and platform fees</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="platformCommission">Platform Commission (%)</Label>
                <Input
                  id="platformCommission"
                  type="number"
                  min="0"
                  max="100"
                  value={settings.platformCommission}
                  onChange={(e) => updateSetting("platformCommission", Number(e.target.value))}
                />
                <p className="text-sm text-gray-500">Percentage taken from each sale</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="affiliateRegistrationFee">Affiliate Registration Fee (₦)</Label>
                <Input
                  id="affiliateRegistrationFee"
                  type="number"
                  min="0"
                  value={settings.affiliateRegistrationFee}
                  onChange={(e) => updateSetting("affiliateRegistrationFee", Number(e.target.value))}
                />
                <p className="text-sm text-gray-500">One-time fee for affiliate registration</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="minimumWithdrawal">Minimum Withdrawal Amount (₦)</Label>
                <Input
                  id="minimumWithdrawal"
                  type="number"
                  min="0"
                  value={settings.minimumWithdrawal}
                  onChange={(e) => updateSetting("minimumWithdrawal", Number(e.target.value))}
                />
                <p className="text-sm text-gray-500">Minimum amount users can withdraw</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxCommissionRate">Maximum Commission Rate (%)</Label>
                <Input
                  id="maxCommissionRate"
                  type="number"
                  min="0"
                  max="100"
                  value={settings.maxCommissionRate}
                  onChange={(e) => updateSetting("maxCommissionRate", Number(e.target.value))}
                />
                <p className="text-sm text-gray-500">Maximum commission vendors can offer</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payout Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Payout Settings
            </CardTitle>
            <CardDescription>Configure when and how payouts are processed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="payoutDay">Payout Day</Label>
                <select
                  id="payoutDay"
                  value={settings.payoutDay}
                  onChange={(e) => updateSetting("payoutDay", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="monday">Monday</option>
                  <option value="tuesday">Tuesday</option>
                  <option value="wednesday">Wednesday</option>
                  <option value="thursday">Thursday</option>
                  <option value="friday">Friday</option>
                </select>
                <p className="text-sm text-gray-500">Day of the week for automatic payouts</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="autoPayouts">Automatic Payouts</Label>
                  <Switch
                    id="autoPayouts"
                    checked={settings.autoPayouts}
                    onCheckedChange={(checked) => updateSetting("autoPayouts", checked)}
                  />
                </div>
                <p className="text-sm text-gray-500">Process payouts automatically without manual approval</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Security & Access
            </CardTitle>
            <CardDescription>Configure security and access control settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="allowNewRegistrations">Allow New Registrations</Label>
                  <p className="text-sm text-gray-500">Allow new users to register on the platform</p>
                </div>
                <Switch
                  id="allowNewRegistrations"
                  checked={settings.allowNewRegistrations}
                  onCheckedChange={(checked) => updateSetting("allowNewRegistrations", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="requireEmailVerification">Require Email Verification</Label>
                  <p className="text-sm text-gray-500">Users must verify their email before accessing the platform</p>
                </div>
                <Switch
                  id="requireEmailVerification"
                  checked={settings.requireEmailVerification}
                  onCheckedChange={(checked) => updateSetting("requireEmailVerification", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="maintenanceMode">Maintenance Mode</Label>
                  <p className="text-sm text-gray-500">Put the platform in maintenance mode</p>
                </div>
                <Switch
                  id="maintenanceMode"
                  checked={settings.maintenanceMode}
                  onCheckedChange={(checked) => updateSetting("maintenanceMode", checked)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
            </CardTitle>
            <CardDescription>Configure email notifications and alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="emailNotifications">Email Notifications</Label>
                  <p className="text-sm text-gray-500">Send email notifications for important events</p>
                </div>
                <Switch
                  id="emailNotifications"
                  checked={settings.emailNotifications}
                  onCheckedChange={(checked) => updateSetting("emailNotifications", checked)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
