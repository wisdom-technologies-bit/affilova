"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  LayoutDashboard,
  Package,
  Users,
  TrendingUp,
  Settings,
  LogOut,
  Menu,
  DollarSign,
  FileText,
  MessageSquare,
  User,
  Store,
  Target,
  CreditCard,
  BarChart3,
  ShoppingCart,
  UserCheck,
  Megaphone,
  BookOpen,
} from "lucide-react"

interface SidebarItem {
  title: string
  href: string
  icon: any
  badge?: string
}

interface DashboardSidebarProps {
  role: "admin" | "vendor" | "affiliate"
  user?: {
    name: string
    email: string
    avatar?: string
  }
}

const sidebarItems = {
  admin: [
    { title: "Overview", href: "/dashboard/admin", icon: LayoutDashboard },
    { title: "Users", href: "/dashboard/admin/users", icon: Users },
    { title: "Products", href: "/dashboard/admin/products", icon: Package },
    { title: "Transactions", href: "/dashboard/admin/transactions", icon: DollarSign },
    { title: "Withdrawals", href: "/dashboard/admin/withdrawals", icon: CreditCard },
    { title: "Support Tickets", href: "/dashboard/admin/support", icon: MessageSquare },
    { title: "Blog", href: "/dashboard/admin/blog", icon: BookOpen },
    { title: "Analytics", href: "/dashboard/admin/analytics", icon: BarChart3 },
    { title: "Settings", href: "/dashboard/admin/settings", icon: Settings },
    { title: "Profile", href: "/dashboard/admin/profile", icon: User },
  ],
  vendor: [
    { title: "Overview", href: "/dashboard/vendor", icon: LayoutDashboard },
    { title: "Products", href: "/dashboard/vendor/products", icon: Package },
    { title: "Affiliates", href: "/dashboard/vendor/affiliates", icon: UserCheck },
    { title: "Sales", href: "/dashboard/vendor/sales", icon: ShoppingCart },
    { title: "Analytics", href: "/dashboard/vendor/analytics", icon: TrendingUp },
    { title: "Store", href: "/dashboard/vendor/store", icon: Store },
    { title: "Resources", href: "/dashboard/vendor/resources", icon: FileText },
    { title: "Advertising", href: "/dashboard/vendor/advertising", icon: Megaphone },
    { title: "Profile", href: "/dashboard/vendor/profile", icon: User },
    { title: "Payment Info", href: "/dashboard/vendor/payment-information", icon: CreditCard },
  ],
  affiliate: [
    { title: "Overview", href: "/dashboard/affiliate", icon: LayoutDashboard },
    { title: "Marketplace", href: "/dashboard/affiliate/marketplace", icon: Store },
    { title: "My Products", href: "/dashboard/affiliate/products", icon: Target },
    { title: "Analytics", href: "/dashboard/affiliate/analytics", icon: TrendingUp },
    { title: "Withdrawals", href: "/dashboard/affiliate/withdrawals", icon: CreditCard },
    { title: "Resources", href: "/dashboard/affiliate/resources", icon: FileText },
    { title: "Profile", href: "/dashboard/affiliate/profile", icon: User },
    { title: "Payment Info", href: "/dashboard/affiliate/payment-information", icon: DollarSign },
  ],
}

export function DashboardSidebar({ role, user }: DashboardSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      router.push("/auth/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-4 border-b">
        <img src="/affilova-logo.png" alt="Affilova" className="h-8 w-auto" />
        <span className="font-semibold text-lg">Affilova</span>
      </div>

      {/* User Info */}
      {user && (
        <div className="px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center overflow-hidden">
              {user.avatar ? (
                <img
                  src={user.avatar || "/placeholder.svg"}
                  alt={user.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-green-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1">
        {sidebarItems[role].map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                isActive ? "bg-green-100 text-green-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )}
              onClick={() => setIsMobileOpen(false)}
            >
              <item.icon className="w-5 h-5" />
              {item.title}
              {item.badge && (
                <span className="ml-auto bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full">{item.badge}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-4 py-4 border-t">
        <Button
          variant="ghost"
          className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={handleLogout}
        >
          <LogOut className="w-5 h-5 mr-3" />
          Logout
        </Button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:bg-white lg:border-r lg:border-gray-200">
        <SidebarContent />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden fixed top-4 left-4 z-50">
            <Menu className="w-6 h-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64">
          <SidebarContent />
        </SheetContent>
      </Sheet>
    </>
  )
}
