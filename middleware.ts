import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyToken } from "@/lib/auth"
import {
  APP_OVERRIDE_COOKIE,
  matchesLegacyMatcher,
  resolveAppOverride,
  resolveRoute,
} from "@/lib/host-routing"
import { APP_HEADER, appForHost, hostMapFromEnv, type AppName } from "@/lib/hosts"

export async function middleware(request: NextRequest) {
  // Resolve which app this request belongs to and pass it down as a request
  // header. Nothing below depends on it yet: every existing rule, redirect and
  // return path is unchanged.
  let app: AppName = "public"

  try {
    app = appForHost({
      host: request.headers.get("host"),
      hosts: hostMapFromEnv(),
      appEnv: process.env.NEXT_PUBLIC_APP_ENV,
      override: request.nextUrl.searchParams.get("app"),
    })
  } catch {
    app = "public"
  }

  // Preview builds only: ?app= leaves a cookie behind, and the cookie stands in
  // for the parameter on the pages that follow. In production this decides
  // nothing and sets nothing.
  const override = resolveAppOverride({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
    queryValue: request.nextUrl.searchParams.get("app"),
    cookieValue: request.cookies.get(APP_OVERRIDE_COOKIE)?.value ?? null,
  })

  if (override.app !== null) {
    app = override.app
  }

  // Rebuild the headers so a client cannot spoof the app by sending its own
  // x-affilova-app header.
  const headers = new Headers(request.headers)
  headers.delete(APP_HEADER)
  headers.set(APP_HEADER, app)

  // Every response below leaves through here, so the preview cookie is set on
  // a redirect and on a rewrite alike.
  const respond = (response: NextResponse): NextResponse => {
    if (override.setCookie !== null) {
      response.cookies.set({
        name: APP_OVERRIDE_COOKIE,
        value: override.setCookie,
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      })
    }

    return response
  }

  const { pathname, search } = request.nextUrl
  const route = resolveRoute({ app, pathname, search })

  // /hosts/* is the internal tree: it is reached by rewrite, never by a URL.
  if (route.kind === "not-found") {
    return respond(
      new NextResponse("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    )
  }

  if (route.kind === "rewrite") {
    return respond(NextResponse.rewrite(new URL(route.to, request.url), { request: { headers } }))
  }

  // The legacy checks below are the ones the old matcher selected. They keep
  // running for exactly the same paths, and only on the public host: an app
  // host serves its own shell, guarded by the layouts, so the old role
  // redirects would only send its visitors back to the public site.
  if (app !== "public" || !matchesLegacyMatcher(pathname)) {
    return respond(NextResponse.next({ request: { headers } }))
  }

  const token = request.cookies.get("auth-token")?.value

  // Check if user is authenticated
  let user = null
  if (token) {
    user = await verifyToken(token)
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/register"))) {
    if (!user.role || user.role === "user") {
      return respond(NextResponse.redirect(new URL("/dashboard/select-role", request.url)))
    }
    const redirectUrl = `/dashboard/${user.role}`
    return respond(NextResponse.redirect(new URL(redirectUrl, request.url)))
  }

  // Protect role selection route
  if (pathname.startsWith("/dashboard/select-role")) {
    if (!user) {
      return respond(NextResponse.redirect(new URL("/auth/login", request.url)))
    }
    if (user.role && user.role !== "user") {
      return respond(NextResponse.redirect(new URL(`/dashboard/${user.role}`, request.url)))
    }
  }

  // Protect dashboard routes
  if (pathname.startsWith("/dashboard") && !pathname.startsWith("/dashboard/select-role") && !user) {
    return respond(NextResponse.redirect(new URL("/auth/login", request.url)))
  }

  // Check role-based access for dashboards
  if (pathname.startsWith("/dashboard/") && user && !pathname.startsWith("/dashboard/select-role")) {
    const dashboardRole = pathname.split("/")[2] // Extract role from /dashboard/[role]
    if (dashboardRole && dashboardRole !== user.role) {
      if (!user.role || user.role === "user") {
        return respond(NextResponse.redirect(new URL("/dashboard/select-role", request.url)))
      }
      return respond(NextResponse.redirect(new URL(`/dashboard/${user.role}`, request.url)))
    }
  }

  // Protect admin routes
  if (pathname.startsWith("/admin") && (!user || user.role !== "admin")) {
    return respond(NextResponse.redirect(new URL("/auth/login", request.url)))
  }

  // Redirect to role selection if user doesn't have a role
  if (
    user &&
    (!user.role || user.role === "user") &&
    !pathname.startsWith("/dashboard/select-role") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth")
  ) {
    return respond(NextResponse.redirect(new URL("/dashboard/select-role", request.url)))
  }

  return respond(NextResponse.next({ request: { headers } }))
}

export const config = {
  // Every path except the build output, the favicon and files with an asset
  // extension. The extensions are the ones in ASSET_EXTENSIONS
  // (lib/host-routing.ts): Next.js only reads this matcher as a literal, so the
  // two lists are kept in step by hand. classifyPath, not the matcher, is what
  // decides whether a path is a file.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:avif|css|eot|gif|ico|jpe?g|js|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|ttf|wav|webmanifest|webm|woff2?)$).*)",
  ],
}
