// Host-aware routing, skeleton only.
//
// This module decides which app a request belongs to, from the request host
// name. It changes no URL, redirect, rewrite or access rule: nothing reads its
// result yet beyond the x-affilova-app header set in middleware.

export type AppName = "public" | "affiliate" | "merchant" | "account" | "admin"

export const APP_HEADER = "x-affilova-app"

export type HostMap = Partial<Record<Exclude<AppName, "public">, string>> & { public?: string }

export const APP_NAMES: readonly AppName[] = ["public", "affiliate", "merchant", "account", "admin"]

export function isAppName(value: string | null | undefined): value is AppName {
  return typeof value === "string" && (APP_NAMES as readonly string[]).includes(value)
}

// Trims the value and treats blank strings as absent, so an empty placeholder
// in a .env file reads the same as a variable that was never set.
function present(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed === "" ? undefined : trimmed
}

// Reads the host variables directly, with a literal reference per variable, so
// an unrelated missing variable can never break routing. Next.js also only
// inlines NEXT_PUBLIC_* values that appear literally.
export function hostMapFromEnv(): HostMap {
  const publicHost = present(process.env.NEXT_PUBLIC_HOST_PUBLIC)
  const affiliateHost = present(process.env.NEXT_PUBLIC_HOST_AFFILIATE)
  const merchantHost = present(process.env.NEXT_PUBLIC_HOST_MERCHANT)
  const accountHost = present(process.env.NEXT_PUBLIC_HOST_ACCOUNT)
  const adminHost = present(process.env.NEXT_PUBLIC_HOST_ADMIN)

  const hosts: HostMap = {}

  if (publicHost !== undefined) {
    hosts.public = publicHost
  }

  if (affiliateHost !== undefined) {
    hosts.affiliate = affiliateHost
  }

  if (merchantHost !== undefined) {
    hosts.merchant = merchantHost
  }

  if (accountHost !== undefined) {
    hosts.account = accountHost
  }

  if (adminHost !== undefined) {
    hosts.admin = adminHost
  }

  return hosts
}

// Trims, lowercases, strips a port and a trailing dot, so that
// "Affiliates.Affilova.Vercel.App.:3000" and "affiliates.affilova.vercel.app"
// compare equal.
export function normalizeHost(host: string | null | undefined): string {
  if (typeof host !== "string") {
    return ""
  }

  const trimmed = host.trim().toLowerCase()

  if (trimmed === "") {
    return ""
  }

  let value = trimmed

  // A trailing ":<digits>" is a port. Checking for digits keeps the colons of
  // an unbracketed IPv6 literal out of it.
  const colon = value.lastIndexOf(":")

  if (colon !== -1 && /^[0-9]+$/.test(value.slice(colon + 1))) {
    value = value.slice(0, colon)
  }

  if (value.endsWith(".")) {
    value = value.slice(0, -1)
  }

  return value
}

// Resolves the app for a request host. The override exists for local work and
// preview builds only: it never applies in production, or when the app
// environment is not configured.
export function appForHost(input: {
  host: string | null | undefined
  hosts: HostMap
  appEnv: string | undefined
  override?: string | null
}): AppName {
  const { host, hosts, appEnv, override } = input

  const overrideAllowed = appEnv !== undefined && appEnv !== "production"

  if (overrideAllowed && isAppName(override)) {
    return override
  }

  const hostName = normalizeHost(host)

  if (hostName === "") {
    return "public"
  }

  for (const appName of APP_NAMES) {
    const mappedHost = hosts[appName]

    if (mappedHost !== undefined && normalizeHost(mappedHost) === hostName) {
      return appName
    }
  }

  return "public"
}

export function parseAppName(value: string | null | undefined): AppName {
  return isAppName(value) ? value : "public"
}
