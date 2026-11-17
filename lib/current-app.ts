import "server-only"

import { headers } from "next/headers"

import { APP_HEADER, parseAppName, type AppName } from "@/lib/hosts"
import { safeNextPath } from "@/lib/identity/safe-next"

// The same name middleware.ts sets. It is repeated rather than imported because
// middleware.ts pulls in next/server: importing it from a server component would
// bundle the edge entry point into every page.
const PATH_HEADER = "x-affilova-path"

// The app this request belongs to, as decided by the middleware from the
// request host. Server components, route handlers and server actions can call
// this to read the value the middleware set.
export async function getCurrentApp(): Promise<AppName> {
  const requestHeaders = await headers()
  const value = requestHeaders.get(APP_HEADER)

  return parseAppName(value)
}

// The path the visitor asked for, before the middleware rewrote it to the
// internal /hosts/<app> tree.
//
// This is what a layout hands to requireUser() or requirePermission(), so that
// signing in returns the visitor to the page they were on: "/products?page=2"
// rather than the app's home. The header is set by the middleware for app hosts
// only, and is passed through safeNextPath() here, because a header is still
// request data and must not be able to turn the sign-in redirect off-site.
export async function getRequestPath(): Promise<string> {
  const requestHeaders = await headers()

  return safeNextPath(requestHeaders.get(PATH_HEADER), "/")
}
