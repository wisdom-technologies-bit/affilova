import { describe, expect, it } from "vitest"

import {
  APP_OVERRIDE_COOKIE,
  classifyPath,
  isHostsPath,
  matchesLegacyMatcher,
  normalizePathname,
  resolveAppOverride,
  resolveRoute,
  type PathKind,
  type RouteDecision,
} from "./host-routing"
import type { AppName } from "./hosts"

// The routing rules on their own: no request, no environment, no Next.js.

const STATIC_PATHS = [
  "/_next/static/chunks/main.js",
  "/_next/image",
  "/brand/affilova-icon.svg",
  "/brand/affilova-logo-horizontal.svg",
  "/favicon.ico",
  "/icon",
  "/icon.svg",
  "/icon-192.png",
  // "/icon*" is a metadata file prefix, so this is a file too, not a page.
  "/icons",
  "/apple-icon.png",
  "/apple-icon-180.png",
  "/manifest.webmanifest",
  "/opengraph-image.png",
  "/twitter-image.png",
  "/robots.txt",
  "/sitemap.xml",
  "/images/hero.jpg",
  "/fonts/inter.woff2",
  "/styles/app.css",
  "/photo.PNG",
  "/docs/handbook.pdf",
  "/media/loop.webm",
]

const SHARED_PATHS = [
  "/api",
  "/api/health",
  "/api/auth/login",
  "/auth",
  "/auth/login",
  "/auth/register",
  "/auth/callback",
  "/auth/confirm",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/start",
  "/start/vendor",
  "/start/affiliate",
  "/monitoring",
  "/monitoring/tunnel",
  "/terms-of-service",
  "/privacy-policy",
]

// Near misses matter as much as the list itself: these all start with a shared
// prefix but are ordinary app pages.
const APP_PATHS = [
  "/",
  "/about",
  "/blog",
  "/blog/a-post",
  "/contact",
  "/how-it-works",
  "/products",
  "/products/a-product",
  "/dashboard",
  "/dashboard/vendor",
  "/admin",
  "/startups",
  "/api-docs",
  "/brands",
  "/monitoring-station",
  "/auth-lookalike",
  "/terms-of-service-2024",
  "/sign-in-help",
]

const APPS: readonly AppName[] = ["public", "affiliate", "merchant", "account", "admin"]

function decide(app: AppName, url: string): RouteDecision {
  const [pathname, search] = url.split(/\?(?=.*)/)
  const queryIndex = url.indexOf("?")

  return resolveRoute({
    app,
    pathname: queryIndex === -1 ? url : url.slice(0, queryIndex),
    search: queryIndex === -1 ? "" : url.slice(queryIndex),
  })
}

describe("normalizePathname", () => {
  it("leaves an ordinary path alone", () => {
    expect(normalizePathname("/products/a-product")).toBe("/products/a-product")
    expect(normalizePathname("/")).toBe("/")
    expect(normalizePathname("")).toBe("/")
  })

  it("removes a trailing slash, including a doubled one", () => {
    expect(normalizePathname("/products/")).toBe("/products")
    expect(normalizePathname("/products//")).toBe("/products")
    expect(normalizePathname("/products//new")).toBe("/products/new")
  })

  it("decodes percent-escapes, repeatedly", () => {
    expect(normalizePathname("/%68osts/admin")).toBe("/hosts/admin")
    expect(normalizePathname("/hosts%2Fadmin")).toBe("/hosts/admin")
    expect(normalizePathname("/%2568osts/admin")).toBe("/hosts/admin")
    expect(normalizePathname("/caf%C3%A9")).toBe("/café")
  })

  it("resolves dot segments", () => {
    expect(normalizePathname("/hosts/../admin")).toBe("/admin")
    expect(normalizePathname("/products/./new")).toBe("/products/new")
    expect(normalizePathname("/../../etc")).toBe("/etc")
  })

  it("keeps a value that is not valid percent-encoding as it arrived", () => {
    expect(normalizePathname("/100%")).toBe("/100%")
    expect(normalizePathname("/%zz")).toBe("/%zz")
  })
})

describe("classifyPath", () => {
  it("treats build output, brand assets and files as static", () => {
    for (const path of STATIC_PATHS) {
      expect(classifyPath(path), path).toBe<PathKind>("static")
    }
  })

  it("treats the auth, API, onboarding, monitoring and legal paths as shared", () => {
    for (const path of SHARED_PATHS) {
      expect(classifyPath(path), path).toBe<PathKind>("shared")
    }
  })

  it("treats everything else as an app path", () => {
    for (const path of APP_PATHS) {
      expect(classifyPath(path), path).toBe<PathKind>("app")
    }
  })

  it("classifies by the normalized path, so escapes cannot disguise a file", () => {
    expect(classifyPath("/%66avicon.ico")).toBe<PathKind>("static")
    expect(classifyPath("/sign-in/")).toBe<PathKind>("shared")
    expect(classifyPath("/%73ign-in")).toBe<PathKind>("shared")
    expect(classifyPath("/start/")).toBe<PathKind>("shared")
  })
})

describe("isHostsPath", () => {
  it("is true only for the internal tree and its root", () => {
    expect(isHostsPath("/hosts")).toBe(true)
    expect(isHostsPath("/hosts/merchant")).toBe(true)
    expect(isHostsPath("/hosts/merchant/products")).toBe(true)
    expect(isHostsPath("/hosts/")).toBe(true)
    expect(isHostsPath("/%68osts/admin")).toBe(true)
  })

  it("is false for a lookalike", () => {
    expect(isHostsPath("/hosts-old")).toBe(false)
    expect(isHostsPath("/")).toBe(false)
  })
})

describe("resolveRoute: the public host passes everything through", () => {
  it("passes every non-internal path", () => {
    for (const path of [...STATIC_PATHS, ...SHARED_PATHS, ...APP_PATHS]) {
      expect(decide("public", path), path).toEqual({ kind: "pass" })
    }
  })

  it("passes the legacy dashboard and admin paths, which the middleware still guards", () => {
    expect(decide("public", "/dashboard/vendor")).toEqual({ kind: "pass" })
    expect(decide("public", "/admin/users")).toEqual({ kind: "pass" })
  })
})

describe("resolveRoute: app hosts rewrite their own paths", () => {
  const appPaths = ["/about", "/products", "/products/a-product", "/blog/a-post"]

  it("rewrites each app path under the app's shell", () => {
    for (const app of ["affiliate", "merchant", "account", "admin"] as const) {
      for (const path of appPaths) {
        expect(decide(app, path), `${app} ${path}`).toEqual({
          kind: "rewrite",
          to: `/hosts/${app}${path}`,
        })
      }
    }
  })

  it("maps the root path to the shell root", () => {
    for (const app of ["affiliate", "merchant", "account", "admin"] as const) {
      expect(decide(app, "/"), app).toEqual({ kind: "rewrite", to: `/hosts/${app}` })
    }
  })

  it("keeps the query string", () => {
    expect(decide("merchant", "/products?page=2&sort=new")).toEqual({
      kind: "rewrite",
      to: "/hosts/merchant/products?page=2&sort=new",
    })
    expect(decide("merchant", "/?app=admin")).toEqual({
      kind: "rewrite",
      to: "/hosts/merchant?app=admin",
    })
  })

  it("accepts a query string without its question mark", () => {
    expect(resolveRoute({ app: "merchant", pathname: "/products", search: "page=2" })).toEqual({
      kind: "rewrite",
      to: "/hosts/merchant/products?page=2",
    })
  })

  it("ignores a trailing slash", () => {
    expect(decide("merchant", "/products/")).toEqual({
      kind: "rewrite",
      to: "/hosts/merchant/products",
    })
    expect(decide("merchant", "/products/?page=2")).toEqual({
      kind: "rewrite",
      to: "/hosts/merchant/products?page=2",
    })
  })

  it("passes static and shared paths through on every host", () => {
    for (const app of ["affiliate", "merchant", "account", "admin"] as const) {
      for (const path of [...STATIC_PATHS, ...SHARED_PATHS]) {
        expect(decide(app, path), `${app} ${path}`).toEqual({ kind: "pass" })
      }
    }
  })

  it("still guards the legacy paths, which now belong to the shell", () => {
    expect(decide("admin", "/dashboard/vendor")).toEqual({
      kind: "rewrite",
      to: "/hosts/admin/dashboard/vendor",
    })
  })
})

describe("resolveRoute: the internal tree is never reachable directly", () => {
  it("is not-found on every host", () => {
    const paths = ["/hosts", "/hosts/admin", "/hosts/merchant", "/hosts/affiliate/products"]

    for (const app of APPS) {
      for (const path of paths) {
        expect(decide(app, path), `${app} ${path}`).toEqual({ kind: "not-found" })
      }
    }
  })

  it("is not-found for an encoded path", () => {
    for (const app of APPS) {
      expect(decide(app, "/%68osts/admin"), app).toEqual({ kind: "not-found" })
      expect(decide(app, "/hosts%2Fadmin"), app).toEqual({ kind: "not-found" })
      expect(decide(app, "/%2568osts/admin"), app).toEqual({ kind: "not-found" })
      expect(decide(app, "/hosts/./admin"), app).toEqual({ kind: "not-found" })
    }
  })
})

describe("resolveAppOverride", () => {
  it("ignores the parameter and the cookie in production", () => {
    expect(
      resolveAppOverride({ appEnv: "production", queryValue: "admin", cookieValue: "merchant" }),
    ).toEqual({ app: null, setCookie: null })
  })

  it("ignores both when the app environment is not configured", () => {
    expect(
      resolveAppOverride({ appEnv: undefined, queryValue: "admin", cookieValue: "merchant" }),
    ).toEqual({ app: null, setCookie: null })
  })

  it("selects the app named by the parameter, and sets the cookie", () => {
    expect(resolveAppOverride({ appEnv: "development", queryValue: "admin" })).toEqual({
      app: "admin",
      setCookie: "admin",
    })
    expect(resolveAppOverride({ appEnv: "preview", queryValue: "merchant" })).toEqual({
      app: "merchant",
      setCookie: "merchant",
    })
  })

  it("reads the cookie when there is no parameter", () => {
    expect(resolveAppOverride({ appEnv: "preview", queryValue: null, cookieValue: "account" })).toEqual(
      { app: "account", setCookie: null },
    )
    expect(
      resolveAppOverride({ appEnv: "development", queryValue: "", cookieValue: "affiliate" }),
    ).toEqual({ app: "affiliate", setCookie: null })
  })

  it("ignores an invalid parameter and falls back to the cookie", () => {
    expect(
      resolveAppOverride({ appEnv: "preview", queryValue: "wizard", cookieValue: "admin" }),
    ).toEqual({ app: "admin", setCookie: null })
    expect(resolveAppOverride({ appEnv: "preview", queryValue: "ADMIN" })).toEqual({
      app: null,
      setCookie: null,
    })
  })

  it("ignores an invalid cookie", () => {
    expect(
      resolveAppOverride({ appEnv: "preview", queryValue: null, cookieValue: "not-an-app" }),
    ).toEqual({ app: null, setCookie: null })
  })

  it("names the cookie it sets", () => {
    expect(APP_OVERRIDE_COOKIE).toBe("affilova_app")
  })
})

describe("matchesLegacyMatcher", () => {
  it("is true for exactly what the old matcher covered", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/vendor",
      "/dashboard/vendor/products/new",
      "/admin",
      "/admin/users",
      "/auth/login",
      "/auth/register",
    ]) {
      expect(matchesLegacyMatcher(path), path).toBe(true)
    }
  })

  it("is false for everything else", () => {
    for (const path of [
      "/",
      "/products",
      "/sign-in",
      "/sign-up",
      "/auth/login/",
      "/auth/forgot-password",
      "/dashboardx",
      "/adminx",
      "/hosts/admin",
    ]) {
      expect(matchesLegacyMatcher(path), path).toBe(false)
    }
  })
})
