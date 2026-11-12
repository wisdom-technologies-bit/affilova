import "server-only"

import { headers } from "next/headers"

import { APP_HEADER, parseAppName, type AppName } from "@/lib/hosts"

// The app this request belongs to, as decided by the middleware from the
// request host. Server components, route handlers and server actions can call
// this to read the value the middleware set.
export async function getCurrentApp(): Promise<AppName> {
  const requestHeaders = await headers()
  const value = requestHeaders.get(APP_HEADER)

  return parseAppName(value)
}
