"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Home, Search, ArrowLeft } from "lucide-react"
import { Logo } from "@/components/brand/logo"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardContent className="p-8 text-center">
          <div className="mb-6">
            <div className="text-6xl font-bold text-gray-300 mb-2">404</div>
            <Logo variant="stacked" className="h-12 w-auto mx-auto" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-4">Page Not Found</h1>
          <p className="text-gray-600 mb-8">
            Sorry, we couldn't find the page you're looking for. It might have been moved, deleted, or you entered the
            wrong URL.
          </p>

          <div className="space-y-3">
            <Link href="/" className="block">
              <Button className="w-full bg-green-600 hover:bg-green-700">
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </Button>
            </Link>

            <Link href="/auth/register" className="block">
              <Button variant="outline" className="w-full">
                <Search className="w-4 h-4 mr-2" />
                Browse Products
              </Button>
            </Link>

            <button
              onClick={() => window.history.back()}
              className="w-full text-sm text-gray-600 hover:text-gray-900 flex items-center justify-center gap-2 py-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          </div>

          <div className="mt-8 pt-6 border-t">
            <p className="text-sm text-gray-500">
              Need help?{" "}
              <Link href="/contact" className="text-green-600 hover:underline">
                Contact Support
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
