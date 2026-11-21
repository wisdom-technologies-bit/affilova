import type { MetadataRoute } from "next"

import { LEGAL_DOCUMENTS } from "@/content/legal"
import { hostMapFromEnv } from "@/lib/hosts"

const PUBLIC_STATIC_ROUTES = [
  "/",
  "/how-it-works",
  "/about",
  "/blog",
  "/contact",
  "/products",
  "/legal",
] as const

function resolvePublicBaseUrl(): string {
  const hosts = hostMapFromEnv()
  if (hosts.public !== undefined) {
    return `https://${hosts.public}`
  }

  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (rawAppUrl !== undefined && rawAppUrl !== "") {
    return rawAppUrl.replace(/\/+$/, "")
  }

  return "https://affilova.com"
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = resolvePublicBaseUrl()

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_STATIC_ROUTES.map((path) => ({
    url: `${baseUrl}${path}`,
    changeFrequency: path === "/products" || path === "/blog" ? "daily" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }))

  const legalEntries: MetadataRoute.Sitemap = LEGAL_DOCUMENTS.map((doc) => ({
    url: `${baseUrl}${doc.href}`,
    lastModified: new Date(doc.effectiveDate),
    changeFrequency: "monthly",
    priority: 0.4,
  }))

  return [...staticEntries, ...legalEntries]
}
