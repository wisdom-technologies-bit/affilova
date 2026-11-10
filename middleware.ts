import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyToken } from "@/lib/auth"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get("auth-token")?.value

  // Check if user is authenticated
  let user = null
  if (token) {
    user = await verifyToken(token)
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/register"))) {
    if (!user.role || user.role === "user") {
      return NextResponse.redirect(new URL("/dashboard/select-role", request.url))
    }
    const redirectUrl = `/dashboard/${user.role}`
    return NextResponse.redirect(new URL(redirectUrl, request.url))
  }

  // Protect role selection route
  if (pathname.startsWith("/dashboard/select-role")) {
    if (!user) {
      return NextResponse.redirect(new URL("/auth/login", request.url))
    }
    if (user.role && user.role !== "user") {
      return NextResponse.redirect(new URL(`/dashboard/${user.role}`, request.url))
    }
  }

  // Protect dashboard routes
  if (pathname.startsWith("/dashboard") && !pathname.startsWith("/dashboard/select-role") && !user) {
    return NextResponse.redirect(new URL("/auth/login", request.url))
  }

  // Check role-based access for dashboards
  if (pathname.startsWith("/dashboard/") && user && !pathname.startsWith("/dashboard/select-role")) {
    const dashboardRole = pathname.split("/")[2] // Extract role from /dashboard/[role]
    if (dashboardRole && dashboardRole !== user.role) {
      if (!user.role || user.role === "user") {
        return NextResponse.redirect(new URL("/dashboard/select-role", request.url))
      }
      return NextResponse.redirect(new URL(`/dashboard/${user.role}`, request.url))
    }
  }

  // Protect admin routes
  if (pathname.startsWith("/admin") && (!user || user.role !== "admin")) {
    return NextResponse.redirect(new URL("/auth/login", request.url))
  }

  // Redirect to role selection if user doesn't have a role
  if (
    user &&
    (!user.role || user.role === "user") &&
    !pathname.startsWith("/dashboard/select-role") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth")
  ) {
    return NextResponse.redirect(new URL("/dashboard/select-role", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/auth/login", "/auth/register"],
}
