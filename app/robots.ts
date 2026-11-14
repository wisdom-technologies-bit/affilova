import type { MetadataRoute } from "next"
import { headers } from "next/headers"

import { appForHost, hostMapFromEnv } from "@/lib/hosts"

// Crawling rules per host: the public site is crawlable, and the signed-in apps
// are not indexed at all. Their layouts also send noindex on every response, so
// this is the second of two independent stops.
//
// Hosts come from hostMapFromEnv(), which reads the variables directly, so a
// request for this file can never fail on an unrelated missing variable.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers()

  const app = appForHost({
    host: requestHeaders.get("host"),
    hosts: hostMapFromEnv(),
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
  })

  if (app !== "public") {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    }
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
  }
}
