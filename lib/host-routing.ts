import { isAppName, type AppName } from "@/lib/hosts"

// Which host serves which path, as pure functions.
//
// Nothing here imports Next.js, reads a cookie or looks at the environment: the
// middleware passes in everything it knows and gets back a decision. That keeps
// the rules readable on their own and testable without a request.

export type PathKind = "static" | "shared" | "app"

export type RouteDecision =
  | { kind: "pass" }
  | { kind: "rewrite"; to: string }
  | { kind: "not-found" }

// Files that are served as they are, on every host. The regexes below match one
// root-level segment, so "/icons" stays an app path while "/icon.svg" is a file.
const ROOT_FILES: readonly RegExp[] = [
  /^\/favicon\.ico$/,
  /^\/manifest\.webmanifest$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /^\/(?:apple-icon|icon|opengraph-image|twitter-image)[^/]*$/,
]

// Never rewritten: the build output and the brand assets.
const STATIC_PREFIXES = ["/_next/", "/brand/"] as const

// Extensions that are always a file, never a page. The middleware matcher in
// middleware.ts excludes the same ones; Next.js requires that matcher to be a
// literal, so the two lists have to be kept in step by hand.
export const ASSET_EXTENSIONS: readonly string[] = [
  "avif",
  "css",
  "eot",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "map",
  "mjs",
  "mp3",
  "mp4",
  "ogg",
  "otf",
  "pdf",
  "png",
  "svg",
  "ttf",
  "wav",
  "webm",
  "webmanifest",
  "woff",
  "woff2",
]

// Paths served by the normal routes on every host: the auth flow, the API, the
// onboarding start, the error-tracking tunnel and the legal pages.
const SHARED_PREFIXES = ["/api", "/auth", "/monitoring", "/start"] as const

const SHARED_EXACT: readonly string[] = [
  "/forgot-password",
  "/privacy-policy",
  "/reset-password",
  "/sign-in",
  "/sign-up",
  "/terms-of-service",
]

// The internal route tree the app shells live in. It is reached by rewrite,
// never by typing the URL.
const HOSTS_PREFIX = "/hosts"

function decodePath(pathname: string): string {
  // A request for /%68osts/admin must resolve to the same thing as /hosts/admin,
  // so escapes are decoded before any decision is made. Repeated decoding
  // covers double encoding. A value that is not valid percent-encoding is
  // returned as it arrived, so a stray "%" cannot throw here.
  let value = pathname

  for (let pass = 0; pass < 3 && value.includes("%"); pass += 1) {
    let decoded: string

    try {
      decoded = decodeURIComponent(value)
    } catch {
      return value
    }

    if (decoded === value) {
      break
    }

    value = decoded
  }

  return value
}

function collapseSegments(segments: readonly string[]): string[] {
  const result: string[] = []

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue
    }

    if (segment === "..") {
      result.pop()
      continue
    }

    result.push(segment)
  }

  return result
}

/**
 * The path a routing decision is made on: escapes decoded, dot segments
 * resolved, empty segments dropped and a trailing slash removed, so that
 * "/start/" and "/start" cannot be classified differently.
 */
export function normalizePathname(pathname: string): string {
  const decoded = decodePath(pathname)
  const segments = collapseSegments(decoded.split("/"))

  if (segments.length === 0) {
    return "/"
  }

  return `/${segments.join("/")}`
}

function hasAssetExtension(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1).toLowerCase()
  const dot = lastSegment.lastIndexOf(".")

  if (dot === -1 || dot === lastSegment.length - 1) {
    return false
  }

  return ASSET_EXTENSIONS.includes(lastSegment.slice(dot + 1))
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * "static" for build output and files, "shared" for routes every host serves
 * from the same place, and "app" for everything a host owns.
 *
 * The path is normalized first, so a trailing slash or an encoded character
 * cannot change the answer.
 */
export function classifyPath(pathname: string): PathKind {
  const path = normalizePathname(pathname)

  if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return "static"
  }

  if (ROOT_FILES.some((pattern) => pattern.test(path)) || hasAssetExtension(path)) {
    return "static"
  }

  if (SHARED_EXACT.includes(path)) {
    return "shared"
  }

  if (SHARED_PREFIXES.some((prefix) => matchesPrefix(path, prefix))) {
    return "shared"
  }

  return "app"
}

/** True for the internal app-shell tree, which is never reachable directly. */
export function isHostsPath(pathname: string): boolean {
  const path = normalizePathname(pathname)

  return matchesPrefix(path, HOSTS_PREFIX)
}

/**
 * True for the paths the legacy middleware matcher covered.
 *
 * The legacy token checks and redirects still run for exactly these paths on
 * the public host. The matcher that used to pass them is matched here by hand:
 * "/dashboard/:path*" and "/admin/:path*" include their own root, while
 * "/auth/login" and "/auth/register" were exact.
 */
export function matchesLegacyMatcher(pathname: string): boolean {
  return (
    matchesPrefix(pathname, "/dashboard") ||
    matchesPrefix(pathname, "/admin") ||
    pathname === "/auth/login" ||
    pathname === "/auth/register"
  )
}

function withSearch(path: string, search: string): string {
  if (search === "") {
    return path
  }

  return search.startsWith("?") ? `${path}${search}` : `${path}?${search}`
}

/**
 * Where a request for pathname on this app should go.
 *
 * The public host passes everything through, as it always has. Every other app
 * host keeps the URL the visitor sees and serves it from /hosts/<app>, so the
 * address bar never shows the internal path.
 */
export function resolveRoute(input: {
  app: AppName
  pathname: string
  search: string
}): RouteDecision {
  const path = normalizePathname(input.pathname)

  // The internal tree is never served to a visitor, on any host.
  if (matchesPrefix(path, HOSTS_PREFIX)) {
    return { kind: "not-found" }
  }

  if (classifyPath(path) !== "app") {
    return { kind: "pass" }
  }

  if (input.app === "public") {
    return { kind: "pass" }
  }

  const target = path === "/" ? `${HOSTS_PREFIX}/${input.app}` : `${HOSTS_PREFIX}/${input.app}${path}`

  return { kind: "rewrite", to: withSearch(target, input.search) }
}

// --- The preview app override ------------------------------------------------

export const APP_OVERRIDE_COOKIE = "affilova_app"

export type OverrideDecision = {
  /** The app the override selects, or null when it does not apply. */
  app: AppName | null
  /** The value the cookie should be set to, or null when nothing should be. */
  setCookie: AppName | null
}

/**
 * The ?app= parameter and the cookie it leaves behind, for preview builds.
 *
 * Neither has any effect in production, and neither has an effect when the app
 * environment is not configured at all: an unset NEXT_PUBLIC_APP_ENV must never
 * make a deployed build switchable. An invalid value is ignored rather than
 * rejected, so a stray ?app= cannot break a page.
 *
 * The parameter is set as a cookie so the preview can be browsed: the first page
 * carries ?app=admin, and every link after it keeps the admin app from the
 * cookie.
 */
export function resolveAppOverride(input: {
  appEnv: string | undefined
  queryValue: string | null
  cookieValue?: string | null
}): OverrideDecision {
  const allowed = input.appEnv !== undefined && input.appEnv !== "production"

  if (!allowed) {
    return { app: null, setCookie: null }
  }

  if (isAppName(input.queryValue)) {
    return { app: input.queryValue, setCookie: input.queryValue }
  }

  if (isAppName(input.cookieValue)) {
    return { app: input.cookieValue, setCookie: null }
  }

  return { app: null, setCookie: null }
}
